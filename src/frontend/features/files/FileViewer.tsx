import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { buildAuthedMediaUrl, fetchFileText } from "../../services/files-api.js";
import { useViewerStore, type ViewerTarget } from "./viewer-store.js";

const MAX_TEXT_PREVIEW_BYTES = 5 * 1024 * 1024;

// PR6 viewers — lazy chunks so markdown/shiki payload only loads when the
// user opens a matching file.
const MarkdownViewer = lazy(() =>
  import("./viewers/MarkdownViewer.js").then((m) => ({ default: m.MarkdownViewer }))
);
const CodeViewer = lazy(() =>
  import("./viewers/CodeViewer.js").then((m) => ({ default: m.CodeViewer }))
);

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

/**
 * Overlay rendered by App.tsx into the `main` grid cell (over the Surface /
 * xterm area). The terminal keeps running underneath and will redraw once
 * the viewer closes. Close via ✕ or Escape.
 */
export function FileViewer(): ReactElement | null {
  const target = useViewerStore((s) => s.target);
  const close = useViewerStore((s) => s.close);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, close]);

  if (!target) return null;

  return (
    <div data-testid="file-viewer" className="absolute inset-0 z-40 flex flex-col bg-bg">
      <ViewerHeader target={target} onClose={close} />
      <div className="min-h-0 flex-1 overflow-auto">
        <ViewerBody target={target} />
      </div>
    </div>
  );
}

function ViewerHeader({
  target,
  onClose
}: {
  target: ViewerTarget;
  onClose: () => void;
}): ReactElement {
  const downloadUrl = buildAuthedMediaUrl("/api/files/download", {
    paneId: target.paneId,
    rel: target.rel
  });
  return (
    <div
      data-testid="file-viewer-header"
      className="flex shrink-0 items-center gap-2 border-b border-line bg-bg-elev px-3 py-1.5"
    >
      <span aria-hidden="true" className="text-base leading-none">
        {iconForMime(target.mime)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-mono text-sm text-ink" title={target.name}>
          {target.name}
        </span>
        <span className="text-[10px] text-ink-mute">
          {formatBytes(target.size)} · {target.mime || "unknown"}
        </span>
      </div>
      <DownloadLink href={downloadUrl} name={target.name} />
      <CloseButton onClose={onClose} />
    </div>
  );
}

function ViewerBody({ target }: { target: ViewerTarget }): ReactElement {
  const mime = target.mime || "";
  const rawUrl = buildAuthedMediaUrl("/api/files/raw", {
    paneId: target.paneId,
    rel: target.rel
  });

  if (mime.startsWith("image/")) {
    if (mime === "image/svg+xml") {
      // SVG can contain scripts — sandbox the iframe so it can't touch same-
      // origin cookies or script the page.
      return (
        <iframe title={target.name} src={rawUrl} sandbox="" className="h-full w-full border-0" />
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-2">
        <img src={rawUrl} alt={target.name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  if (mime.startsWith("video/")) {
    return <video src={rawUrl} controls className="h-full w-full bg-black object-contain" />;
  }

  if (mime.startsWith("audio/")) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <audio src={rawUrl} controls className="w-full max-w-md" />
      </div>
    );
  }

  if (mime === "application/pdf") {
    return <iframe title={target.name} src={rawUrl} className="h-full w-full border-0 bg-white" />;
  }

  if (mime === "text/html") {
    return (
      <iframe
        title={target.name}
        src={rawUrl}
        sandbox=""
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  if (target.size > MAX_TEXT_PREVIEW_BYTES) {
    return <OversizeNotice sizeBytes={target.size} />;
  }

  if (mime === "text/markdown" || /\.(md|markdown)$/i.test(target.name)) {
    return (
      <Suspense fallback={<LoadingText />}>
        <LazyText target={target}>{(text) => <MarkdownViewer text={text} />}</LazyText>
      </Suspense>
    );
  }

  if (mime === "application/json" || /\.(json)$/i.test(target.name)) {
    return <LazyText target={target}>{(text) => <JsonViewer text={text} />}</LazyText>;
  }

  if (isLikelyCode(mime, target.name) || mime.startsWith("text/")) {
    return (
      <Suspense fallback={<LoadingText />}>
        <LazyText target={target}>
          {(text) => <CodeViewer text={text} filename={target.name} mime={mime} />}
        </LazyText>
      </Suspense>
    );
  }

  return <UnknownNotice target={target} />;
}

function LazyText({
  target,
  children
}: {
  target: ViewerTarget;
  children: (text: string) => ReactElement;
}): ReactElement {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetchFileText(target.paneId, target.rel)
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [target.paneId, target.rel]);

  if (error) return <p className="p-4 text-xs text-err">{error}</p>;
  if (text === null) return <LoadingText />;
  return children(text);
}

function LoadingText(): ReactElement {
  const { t } = useTranslation();
  return <p className="p-4 text-xs text-ink-mute">{t("files.loading")}</p>;
}

function OversizeNotice({ sizeBytes }: { sizeBytes: number }): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="max-w-sm text-center text-xs text-ink-mute">
        {t("files.oversize", { size: formatBytes(sizeBytes) })}
      </p>
    </div>
  );
}

function DownloadLink({ href, name }: { href: string; name: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      download={name}
      className="rounded border border-line-strong px-2 py-1 text-xs text-ink hover:bg-bg-raised"
    >
      {t("files.download")}
    </a>
  );
}

function CloseButton({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("files.closeLabel")}
      title={t("files.closeTooltip")}
      className="rounded px-2 py-1 text-ink-dim hover:bg-bg-raised hover:text-ink"
    >
      ✕
    </button>
  );
}

function UnknownNotice({ target }: { target: ViewerTarget }): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center text-xs text-ink-mute">
        <p>{t("files.noPreviewMime", { mime: target.mime || "unknown" })}</p>
        <p className="mt-2">{t("files.noPreviewHint")}</p>
      </div>
    </div>
  );
}

function JsonViewer({ text }: { text: string }): ReactElement {
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Not valid JSON — fall back to raw text.
  }
  return (
    <pre className="m-0 h-full overflow-auto whitespace-pre bg-bg px-3 py-2 font-mono text-xs text-ink">
      {pretty}
    </pre>
  );
}

function iconForMime(mime: string): string {
  if (!mime) return "📄";
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime === "application/pdf") return "📕";
  if (mime === "text/html") return "🌐";
  if (mime === "text/markdown") return "📝";
  if (mime.startsWith("text/")) return "📄";
  return "📦";
}

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "fish",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "css",
  "scss",
  "less",
  "vue",
  "svelte",
  "sql",
  "graphql",
  "gql",
  "dockerfile",
  "makefile",
  "lua",
  "php",
  "pl",
  "r"
]);

function isLikelyCode(mime: string, name: string): boolean {
  if (mime.includes("javascript") || mime.includes("typescript")) return true;
  if (mime === "application/xml" || mime.endsWith("+xml")) return true;
  const dot = name.lastIndexOf(".");
  if (dot >= 0) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (CODE_EXTENSIONS.has(ext)) return true;
  }
  // Dockerfile / Makefile (no extension).
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile") return true;
  return false;
}
