import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  browseDirectory,
  makeDirectory,
  FsPickerError,
  type BrowseResponse
} from "../../services/fs-picker-api.js";

/**
 * ADR-0014: directory browser embedded in NewSessionSheet. The caller passes
 * a starting path (typically $HOME via "~"); the user navigates freely and
 * either picks a directory ("use this") or cancels back to the wizard form.
 *
 * No file listing — this picker only selects directories. Hidden directories
 * are toggled via an Eye button (default off). A "+ new folder" button calls
 * the mkdir API and refreshes.
 */
export interface DirectoryPickerProps {
  /** Initial path; "~" is expanded server-side. */
  initialPath: string;
  onCancel: () => void;
  onConfirm: (absolutePath: string) => void;
}

export function DirectoryPicker({
  initialPath,
  onCancel,
  onConfirm
}: DirectoryPickerProps): ReactElement {
  const { t } = useTranslation();
  const [response, setResponse] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [mkdirError, setMkdirError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const navigate = (targetPath: string): void => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    browseDirectory(targetPath)
      .then((res) => {
        if (requestSeqRef.current !== seq) return;
        setResponse(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestSeqRef.current !== seq) return;
        setError(err instanceof FsPickerError ? err.message : String(err));
        setLoading(false);
      });
  };

  useEffect(() => {
    navigate(initialPath);
    // initialPath is the seed only; internal navigation drives refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMkdirSubmit = (): void => {
    if (!response) return;
    const name = mkdirName.trim();
    if (!name) return;
    setMkdirError(null);
    makeDirectory(response.path, name)
      .then(() => {
        setMkdirOpen(false);
        setMkdirName("");
        navigate(response.path);
      })
      .catch((err: unknown) => {
        setMkdirError(err instanceof FsPickerError ? err.message : String(err));
      });
  };

  const entries = response?.entries ?? [];
  const visibleEntries = showHidden ? entries : entries.filter((e) => !e.isHidden);
  const currentPath = response?.path ?? initialPath;
  const parent = response?.parent ?? null;
  const root = response?.root ?? "";

  return (
    <div className="flex flex-col gap-2" data-testid="directory-picker">
      {/* Breadcrumb / current path */}
      <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-md border border-line bg-bg px-2 py-1.5 text-[11px]">
        <span className="text-ink-mute">{t("picker.pathLabel")}</span>
        <Breadcrumb path={currentPath} root={root} onNavigate={navigate} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1">
        <ToolbarButton
          testId="dir-picker-up"
          onClick={() => {
            if (parent) navigate(parent);
          }}
          disabled={!parent}
          label={t("picker.up")}
        />
        {root && root !== currentPath && (
          <ToolbarButton
            testId="dir-picker-home"
            onClick={() => navigate(root)}
            label={t("picker.root")}
          />
        )}
        <ToolbarButton
          testId="dir-picker-toggle-hidden"
          onClick={() => setShowHidden((v) => !v)}
          label={showHidden ? t("picker.hideDotfiles") : t("picker.showDotfiles")}
          active={showHidden}
        />
        <ToolbarButton
          testId="dir-picker-mkdir-open"
          onClick={() => {
            setMkdirOpen(true);
            setMkdirError(null);
          }}
          label={t("picker.newFolder")}
        />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onCancel}
            data-testid="dir-picker-cancel"
            className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-dim hover:bg-bg-raised hover:text-ink"
          >
            {t("picker.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(currentPath)}
            disabled={loading || !response}
            data-testid="dir-picker-confirm"
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-bg disabled:bg-line-strong disabled:text-ink-mute"
          >
            {t("picker.useThis")}
          </button>
        </div>
      </div>

      {/* Inline mkdir form */}
      {mkdirOpen && (
        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-bg p-2">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              placeholder={t("picker.newFolderPlaceholder")}
              data-testid="dir-picker-mkdir-name"
              autoFocus
              className="flex-1 rounded-md border border-line-strong bg-bg-raised px-2 py-1.5 font-mono text-xs text-ink focus:border-accent focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleMkdirSubmit();
                } else if (e.key === "Escape") {
                  setMkdirOpen(false);
                  setMkdirName("");
                }
              }}
            />
            <button
              type="button"
              onClick={handleMkdirSubmit}
              disabled={!mkdirName.trim()}
              data-testid="dir-picker-mkdir-submit"
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim hover:bg-bg-raised hover:text-ink disabled:opacity-40"
            >
              {t("picker.create")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMkdirOpen(false);
                setMkdirName("");
                setMkdirError(null);
              }}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim hover:bg-bg-raised hover:text-ink"
            >
              {t("picker.cancel")}
            </button>
          </div>
          {mkdirError && (
            <div className="text-[11px] text-red-400" data-testid="dir-picker-mkdir-error">
              {mkdirError}
            </div>
          )}
        </div>
      )}

      {/* Directory list */}
      <div
        className="max-h-[40vh] min-h-[120px] overflow-y-auto rounded-md border border-line bg-bg"
        data-testid="dir-picker-list"
      >
        {loading && <div className="px-3 py-3 text-xs text-ink-mute">{t("picker.loading")}</div>}
        {!loading && error && (
          <div className="px-3 py-3 text-xs text-red-400" data-testid="dir-picker-error">
            {error}
          </div>
        )}
        {!loading && !error && response?.readError && (
          <div className="px-3 py-3 text-xs text-yellow-400">{response.readError}</div>
        )}
        {!loading && !error && visibleEntries.length === 0 && !response?.readError && (
          <div className="px-3 py-3 text-xs text-ink-mute">{t("picker.emptyDir")}</div>
        )}
        {!loading && !error && visibleEntries.length > 0 && (
          <ul className="flex flex-col">
            {visibleEntries.map((entry) => {
              const childPath = joinPath(currentPath, entry.name);
              return (
                <li key={entry.name}>
                  <button
                    type="button"
                    onClick={() => navigate(childPath)}
                    data-testid="dir-picker-entry"
                    data-entry-name={entry.name}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-ink-dim hover:bg-bg-raised hover:text-ink"
                  >
                    <span aria-hidden="true">{entry.isSymlink ? "🔗" : "📁"}</span>
                    <span className={`truncate ${entry.isHidden ? "text-ink-mute" : ""}`}>
                      {entry.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

interface BreadcrumbProps {
  path: string;
  /** Workspace root — the breadcrumb stops here; segments above are hidden. */
  root: string;
  onNavigate: (path: string) => void;
}

function Breadcrumb({ path, root, onNavigate }: BreadcrumbProps): ReactElement {
  // Clamp at workspace root. If the current path starts with root, render
  // crumbs as [root-label, ...segments-below-root]. Otherwise (unexpected —
  // backend should 403 first) fall back to a root-only breadcrumb.
  const segments: { label: string; target: string }[] = [];
  const rootLabel = root.split("/").filter(Boolean).pop() || "/";
  segments.push({ label: rootLabel, target: root });

  if (root && path.startsWith(root + "/")) {
    const suffix = path.slice(root.length + 1);
    const parts = suffix.split("/").filter(Boolean);
    let cum = root;
    for (const part of parts) {
      cum = cum === "/" ? `/${part}` : `${cum}/${part}`;
      segments.push({ label: part, target: cum });
    }
  } else if (root === "/" && path !== "/") {
    // Root literally IS "/" — fall back to the original behavior.
    const parts = path.split("/").filter(Boolean);
    let cum = "";
    for (const part of parts) {
      cum += `/${part}`;
      segments.push({ label: part, target: cum });
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5 font-mono">
      {segments.map((seg, i) => (
        <span key={seg.target} className="flex items-center gap-0.5">
          {i > 0 && <span className="text-ink-mute">/</span>}
          <button
            type="button"
            onClick={() => onNavigate(seg.target)}
            data-testid="dir-picker-crumb"
            data-crumb={seg.target}
            className={`rounded px-1 py-0.5 transition-colors ${
              i === segments.length - 1
                ? "bg-accent/15 text-ink"
                : "text-ink-dim hover:bg-bg-raised hover:text-ink"
            }`}
          >
            {seg.label}
          </button>
        </span>
      ))}
    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  testId: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

function ToolbarButton({
  label,
  testId,
  onClick,
  disabled,
  active
}: ToolbarButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-pressed={active}
      className={`rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${
        active
          ? "border-accent bg-accent/15 text-ink"
          : "border-line bg-bg-raised text-ink-dim hover:border-line-strong hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

const joinPath = (parent: string, child: string): string => {
  if (parent === "/") return `/${child}`;
  return `${parent}/${child}`;
};
