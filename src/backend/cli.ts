#!/usr/bin/env node
/* eslint-disable no-console -- CLI prints user-facing startup info on stdout */
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { AuthService } from "./auth/auth-service.js";
import { normalizeBasePath, type CliArgs, type RuntimeConfig } from "./config.js";
import { NodePtyFactory } from "./pty/node-pty-adapter.js";
import { createTMAgentServer } from "./server.js";
import { TmuxCliExecutor } from "./tmux/cli-executor.js";
import { createLogger } from "./util/file-logger.js";
import { randomToken } from "./util/random.js";

const parseCliArgs = async (): Promise<CliArgs> => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("tm-agent")
    .option("port", {
      alias: "p",
      type: "number",
      default: 8767,
      describe: "Local port"
    })
    .option("password", {
      type: "string",
      describe: "Password for authentication (auto-generated when protection is enabled)"
    })
    .option("require-password", {
      type: "boolean",
      default: true,
      describe: "Require password authentication"
    })
    .option("session", {
      type: "string",
      default: "main",
      describe: "Default tmux session name"
    })
    .option("scrollback", {
      type: "number",
      default: 1000,
      describe: "Default scrollback capture lines"
    })
    .option("debug-log", {
      type: "string",
      describe: "Write debug logs to a file"
    })
    .option("workspace-root", {
      type: "string",
      describe:
        "Absolute path used as the upper bound for the session wizard's directory browser. Defaults to $HOME."
    })
    .option("base-path", {
      type: "string",
      describe:
        "URL path prefix to mount the app under (e.g. /tmux). Default empty (root-mount). Required when serving behind a reverse proxy on a subpath instead of a dedicated subdomain."
    })
    .strict()
    .help()
    .parseAsync();

  return {
    port: argv.port,
    password: argv.password,
    requirePassword: argv.requirePassword,
    session: argv.session,
    scrollback: argv.scrollback,
    debugLog: argv.debugLog,
    workspaceRoot: argv.workspaceRoot,
    basePath: argv.basePath
  };
};

const resolveWorkspaceRoot = (raw: string | undefined): string => {
  const source = raw ?? process.env.TM_AGENT_WORKSPACE_ROOT;
  if (!source || !source.trim()) return homedir();
  const trimmed = source.trim();
  const expanded =
    trimmed === "~"
      ? homedir()
      : trimmed.startsWith("~/")
        ? path.join(homedir(), trimmed.slice(2))
        : trimmed;
  return path.resolve(expanded);
};

const buildLaunchUrl = (baseUrl: string, basePath: string, token: string): string => {
  const url = new URL(baseUrl);
  url.pathname = basePath ? `${basePath}/` : "/";
  url.searchParams.set("token", token);
  return url.toString();
};

// ANSI helpers — only active on a real TTY so journald / CI logs stay clean.
const tty = process.stdout.isTTY;
const ansi = (code: string, text: string): string => (tty ? `${code}${text}\x1b[0m` : text);
const bold = (t: string): string => ansi("\x1b[1m", t);
const dim = (t: string): string => ansi("\x1b[2m", t);
const cyan = (t: string): string => ansi("\x1b[36m", t);
const green = (t: string): string => ansi("\x1b[32m", t);
const yellow = (t: string): string => ansi("\x1b[33m", t);

const printConnectionInfo = (
  localUrl: string,
  token: string,
  password: string | undefined,
  isDevMode: boolean,
  workspaceRoot: string,
  basePath: string
): void => {
  const frontendUrl = isDevMode ? `http://localhost:5173` : localUrl;
  const revealSecrets = tty;
  const localWithToken = revealSecrets
    ? buildLaunchUrl(frontendUrl, basePath, token)
    : buildLaunchUrl(frontendUrl, basePath, "<redacted>");

  console.log("");
  console.log(bold(cyan("  TM-Agent ready")));
  console.log(dim("  ────────────────────────────────────────────────"));
  console.log(`  ${dim("Frontend       ")} ${frontendUrl}${isDevMode ? dim(" (Vite dev)") : ""}`);
  console.log(`  ${dim("Backend        ")} ${localUrl}`);
  console.log(`  ${dim("Workspace root ")} ${workspaceRoot}`);
  if (basePath) {
    console.log(`  ${dim("Base path      ")} ${basePath}`);
  }
  console.log(dim("  ────────────────────────────────────────────────"));
  console.log("");
  console.log(`  ${bold("Open in your browser:")}`);
  if (revealSecrets) {
    console.log(`  ${green(localWithToken)}`);
  } else {
    console.log(`  ${green(localWithToken)}`);
    console.log(dim("  Token/password redacted because stdout is not a TTY."));
    console.log(dim("  Read the configured values from /etc/tm-agent/env."));
  }
  if (password && revealSecrets) {
    console.log("");
    console.log(`  ${bold("Password:")} ${yellow(password)}`);
  }
  console.log("");
  if (!process.env.TM_AGENT_TOKEN) {
    console.log(dim("  Heads-up: token + password are freshly generated on every start."));
    console.log(dim("  Pin them by setting TM_AGENT_TOKEN and TM_AGENT_PASSWORD"));
    console.log(dim("  in /etc/tm-agent/env — or just run scripts/install.sh."));
    console.log("");
  }
};

const main = async (): Promise<void> => {
  const args = await parseCliArgs();
  const passwordFromEnv = process.env.TM_AGENT_PASSWORD;
  const effectivePassword = args.requirePassword
    ? (args.password ?? passwordFromEnv ?? randomToken(16))
    : undefined;
  const authService = new AuthService(effectivePassword, process.env.TM_AGENT_TOKEN);
  const debugLogPath = args.debugLog ?? process.env.TM_AGENT_DEBUG_LOG;
  const logger = createLogger(debugLogPath);
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const frontendDir = path.resolve(cliDir, "../frontend");

  const uploadMbFromEnv = Number.parseInt(process.env.TM_AGENT_FILES_MAX_UPLOAD_MB ?? "", 10);
  const filesMaxUploadBytes =
    (Number.isFinite(uploadMbFromEnv) && uploadMbFromEnv > 0 ? uploadMbFromEnv : 100) * 1024 * 1024;

  const workspaceRoot = resolveWorkspaceRoot(args.workspaceRoot);
  const basePath = normalizeBasePath(args.basePath ?? process.env.TM_AGENT_BASE_PATH);

  const config: RuntimeConfig = {
    port: args.port,
    host: "127.0.0.1",
    password: effectivePassword,
    defaultSession: args.session,
    scrollbackLines: args.scrollback,
    pollIntervalMs: 2_500,
    token: authService.token,
    frontendDir,
    filesMaxUploadBytes,
    workspaceRoot,
    basePath
  };

  const tmux = new TmuxCliExecutor({
    socketName: process.env.TM_AGENT_SOCKET_NAME,
    socketPath: process.env.TM_AGENT_SOCKET_PATH,
    logger
  });
  const ptyFactory = new NodePtyFactory(logger);
  const runningServer = createTMAgentServer(config, {
    tmux,
    ptyFactory,
    authService,
    logger
  });

  if (debugLogPath) {
    logger.log(`Debug log file: ${path.resolve(debugLogPath)}`);
  }

  await runningServer.start();

  const isDevMode = process.env.VITE_DEV_MODE === "1";
  printConnectionInfo(
    `http://localhost:${args.port}`,
    authService.token,
    effectivePassword,
    isDevMode,
    workspaceRoot,
    basePath
  );

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async (): Promise<void> => {
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }
    shutdownPromise = runningServer.stop();
    try {
      await shutdownPromise;
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
};

void main();
