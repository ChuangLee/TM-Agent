import { useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

function CodeHighlightLoading(): ReactElement {
  const { t } = useTranslation();
  return <p className="p-4 text-xs text-ink-mute">{t("files.codeHighlightLoading")}</p>;
}

export interface CodeViewerProps {
  text: string;
  filename: string;
  mime: string;
}

// Languages eagerly registered at highlighter creation. Enough to cover
// everyday code reading. Unknown files fall back to "text".
const LANG_WHITELIST: BundledLanguage[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "ruby",
  "go",
  "rust",
  "java",
  "kotlin",
  "swift",
  "c",
  "cpp",
  "shellscript",
  "bash",
  "yaml",
  "toml",
  "json",
  "xml",
  "html",
  "css",
  "scss",
  "markdown",
  "sql",
  "dockerfile",
  "lua",
  "php",
  "perl"
];

/**
 * Shiki-powered syntax highlighting. Highlighter is a singleton — shared
 * across all viewer openings within a session. First open incurs ~200ms of
 * wasm init + grammar load; subsequent opens are instant.
 *
 * The theme is fixed to `github-dark` to match the app's dark aesthetic
 * (ADR-0010 assumes dark). A theme picker is Post-v1 #6.
 */
let highlighterPromise: Promise<Highlighter> | null = null;

const getHighlighter = async (): Promise<Highlighter> => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: LANG_WHITELIST
    });
  }
  return highlighterPromise;
};

const pickLang = (filename: string, mime: string): BundledLanguage | "text" => {
  const lower = filename.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "text";
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  const byExt: Record<string, BundledLanguage> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "jsx",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cc: "cpp",
    cpp: "cpp",
    hpp: "cpp",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    json: "json",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    md: "markdown",
    sql: "sql",
    lua: "lua",
    php: "php",
    pl: "perl"
  };
  if (ext in byExt) return byExt[ext];
  if (mime.includes("javascript")) return "javascript";
  if (mime.includes("typescript")) return "typescript";
  if (mime.includes("xml")) return "xml";
  if (mime.includes("html")) return "html";
  return "text";
};

export function CodeViewer({ text, filename, mime }: CodeViewerProps): ReactElement {
  const [html, setHtml] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const lang = pickLang(filename, mime);
    if (lang === "text") {
      setFallback(true);
      return;
    }
    getHighlighter()
      .then(async (hl) => {
        if (cancelled) return;
        const out = hl.codeToHtml(text, { lang, theme: "github-dark" });
        setHtml(out);
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
    };
  }, [text, filename, mime]);

  if (fallback) {
    return (
      <pre
        data-testid="code-viewer-fallback"
        className="m-0 h-full overflow-auto whitespace-pre bg-bg px-3 py-2 font-mono text-xs text-ink"
      >
        {text}
      </pre>
    );
  }

  if (html === null) {
    return <CodeHighlightLoading />;
  }

  return (
    <div
      data-testid="code-viewer-shiki"
      // Shiki emits a <pre> with inline background styles + per-token spans.
      // `shiki-host` is a local class hook so we can override the default
      // padding without fighting the inline style from shiki itself.
      className="shiki-host h-full overflow-auto text-xs"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
