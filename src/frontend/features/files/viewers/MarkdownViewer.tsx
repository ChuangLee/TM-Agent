import type { ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownViewerProps {
  text: string;
}

/**
 * Lazy-loaded from FileViewer. Uses react-markdown + remark-gfm for a decent
 * baseline (tables, task lists, autolinks, strikethrough). Code blocks fall
 * through to plain `<pre><code>` for now; inline shiki is intentionally
 * skipped here — MD code blocks don't benefit enough to justify the wasm
 * payload that's already justified for CodeViewer.
 *
 * Links open in a new tab so the viewer never navigates the shell page
 * out from under the user.
 */
export function MarkdownViewer({ text }: MarkdownViewerProps): ReactElement {
  return (
    <div
      data-testid="markdown-viewer"
      className="prose prose-invert mx-auto max-w-3xl px-6 py-5 text-sm text-ink"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          h1: ({ node: _node, ...props }) => (
            <h1 className="mt-4 mb-3 text-xl font-semibold text-ink" {...props} />
          ),
          h2: ({ node: _node, ...props }) => (
            <h2 className="mt-4 mb-2 text-lg font-semibold text-ink" {...props} />
          ),
          h3: ({ node: _node, ...props }) => (
            <h3 className="mt-3 mb-2 text-base font-semibold text-ink" {...props} />
          ),
          p: ({ node: _node, ...props }) => (
            <p className="my-2 leading-relaxed text-ink" {...props} />
          ),
          ul: ({ node: _node, ...props }) => (
            <ul className="my-2 list-disc pl-6 text-ink" {...props} />
          ),
          ol: ({ node: _node, ...props }) => (
            <ol className="my-2 list-decimal pl-6 text-ink" {...props} />
          ),
          code: ({ node: _node, className, children, ...props }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <pre className="my-3 overflow-auto rounded bg-bg-elev px-3 py-2 text-xs">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            return (
              <code
                className="rounded bg-bg-elev px-1 py-0.5 font-mono text-[0.85em] text-ink"
                {...props}
              >
                {children}
              </code>
            );
          },
          blockquote: ({ node: _node, ...props }) => (
            <blockquote
              className="my-3 border-l-2 border-line-strong pl-3 text-ink-dim"
              {...props}
            />
          ),
          table: ({ node: _node, ...props }) => (
            <div className="my-3 overflow-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          th: ({ node: _node, ...props }) => (
            <th
              className="border border-line-strong bg-bg-elev px-2 py-1 text-left font-semibold"
              {...props}
            />
          ),
          td: ({ node: _node, ...props }) => (
            <td className="border border-line-strong px-2 py-1" {...props} />
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
