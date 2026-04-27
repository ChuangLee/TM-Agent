import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "../../components/BottomSheet.js";
import { useNewSessionStore, type CustomCommand } from "../../stores/new-session-store.js";
import { useServerConfigStore } from "../../stores/server-config-store.js";
import { DirectoryPicker } from "./DirectoryPicker.js";

export interface NewSessionSubmit {
  name: string;
  cwd?: string;
  startupCommand?: string;
}

export interface NewSessionSheetProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: NewSessionSubmit) => void;
}

/**
 * Built-in agent presets. Each entry maps to a command selector button and
 * a list of boolean flags exposed as toggle chips. The list is deliberately
 * short — common flags only — and users can fill the gap via the custom
 * command path, which can be saved to the library.
 *
 * See ADR-0014 for why these live as a frontend constant (small, stable,
 * no AI-specific code path — just preset strings).
 */
interface AgentPreset {
  id: string;
  label: string;
  command: string;
  flags: string[];
}

const AGENT_PRESETS: AgentPreset[] = [
  {
    id: "claude",
    label: "claude",
    command: "claude",
    flags: ["--continue", "--resume"]
  },
  { id: "codex", label: "codex", command: "codex", flags: [] },
  { id: "gemini", label: "gemini", command: "gemini", flags: [] },
  { id: "hermes", label: "hermes", command: "hermes", flags: [] }
];

type CommandSelection =
  | { kind: "none" }
  | { kind: "preset"; presetId: string }
  | { kind: "custom-library"; id: string }
  | { kind: "custom-new" };

/**
 * Fallback when /api/config didn't return a workspaceRoot (pre-ADR-0017
 * backend). Tilde is expanded server-side so `new_session { cwd: "~" }`
 * still lands in $HOME.
 */
const FALLBACK_CWD = "~";

export function NewSessionSheet({ open, onClose, onSubmit }: NewSessionSheetProps): ReactElement {
  const { t } = useTranslation();
  const workspaceRoot = useServerConfigStore((s) => s.workspaceRoot);
  const defaultCwd = workspaceRoot ?? FALLBACK_CWD;
  const recentCwds = useNewSessionStore((s) => s.recentCwds);
  const customCommands = useNewSessionStore((s) => s.customCommands);
  const lastForm = useNewSessionStore((s) => s.lastForm);
  const addRecentCwd = useNewSessionStore((s) => s.addRecentCwd);
  const addCustomCommand = useNewSessionStore((s) => s.addCustomCommand);
  const removeCustomCommand = useNewSessionStore((s) => s.removeCustomCommand);
  const rememberLast = useNewSessionStore((s) => s.rememberLast);

  const [name, setName] = useState("");
  const [cwd, setCwd] = useState(defaultCwd);
  const [selection, setSelection] = useState<CommandSelection>({ kind: "none" });
  const [flags, setFlags] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  // View switcher: the wizard shows either the form or the directory picker.
  // We embed rather than nest a second BottomSheet — stacked sheets on mobile
  // have bad focus/keyboard UX.
  const [view, setView] = useState<"form" | "picker">("form");

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset form to "last submitted values" when the sheet opens. Session name
  // always starts empty — prefilling it would bias the user toward reusing
  // a name that likely clashes with an existing session.
  useEffect(() => {
    if (!open) return;
    setName("");
    if (lastForm) {
      setCwd(lastForm.cwd || defaultCwd);
      const savedSelection = resolveSavedSelection(lastForm.command, customCommands);
      setSelection(savedSelection);
      setFlags(lastForm.flags);
    } else {
      setCwd(defaultCwd);
      setSelection({ kind: "none" });
      setFlags([]);
    }
    setCustomText("");
    setCustomLabel("");
    setView("form");
    queueMicrotask(() => nameInputRef.current?.focus());
  }, [open, lastForm, customCommands, defaultCwd]);

  const preset =
    selection.kind === "preset"
      ? AGENT_PRESETS.find((p) => p.id === selection.presetId)
      : undefined;

  const custom =
    selection.kind === "custom-library"
      ? customCommands.find((c) => c.id === selection.id)
      : undefined;

  const finalCommand = useMemo(() => {
    if (selection.kind === "none") return "";
    if (selection.kind === "preset" && preset) {
      return [preset.command, ...flags].filter(Boolean).join(" ");
    }
    if (selection.kind === "custom-library" && custom) {
      return custom.command;
    }
    if (selection.kind === "custom-new") {
      return customText.trim();
    }
    return "";
  }, [selection, preset, custom, flags, customText]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const submit = (): void => {
    if (!canSubmit) return;
    // Always forward non-empty cwd to the backend so it resolves `~` via
    // $HOME; empty means "tmux server's cwd" which is usually `/`.
    const cwdTrimmed = cwd.trim();
    onSubmit({
      name: trimmedName,
      cwd: cwdTrimmed || undefined,
      startupCommand: finalCommand || undefined
    });
    if (cwdTrimmed && cwdTrimmed !== defaultCwd) {
      // Recent list only tracks meaningful user input — "~" is the default
      // and would otherwise dominate the chip row.
      addRecentCwd(cwdTrimmed);
    }
    rememberLast({
      cwd: cwdTrimmed,
      command: serializeSelection(selection),
      flags: selection.kind === "preset" ? flags : []
    });
    onClose();
  };

  const handlePresetClick = (presetId: string): void => {
    setSelection({ kind: "preset", presetId });
    setFlags([]);
  };

  const handleCustomLibraryClick = (id: string): void => {
    setSelection({ kind: "custom-library", id });
    setFlags([]);
  };

  const handleCustomNewClick = (): void => {
    setSelection({ kind: "custom-new" });
    setFlags([]);
  };

  const toggleFlag = (flag: string): void => {
    setFlags((prev) => (prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag]));
  };

  const handleSaveCustom = (): void => {
    const cmd = customText.trim();
    if (!cmd) return;
    const label = customLabel.trim() || cmd;
    const entry = addCustomCommand(label, cmd);
    setSelection({ kind: "custom-library", id: entry.id });
    setCustomText("");
    setCustomLabel("");
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={view === "picker" ? t("sessions.pickerTitle") : t("sessions.newSessionTitle")}
      id="new-session-sheet"
    >
      {view === "picker" ? (
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
          <DirectoryPicker
            initialPath={cwd.trim() || defaultCwd}
            onCancel={() => setView("form")}
            onConfirm={(picked) => {
              setCwd(picked);
              setView("form");
            }}
          />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-4 py-4"
          data-testid="new-session-form"
        >
          {/* Name */}
          <label className="flex flex-col gap-1 text-xs text-ink-dim">
            {t("sessions.sheetNameLabel")}
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="new-session-name"
              placeholder={t("sessions.sessionNamePlaceholder")}
              className="rounded-md border border-line-strong bg-bg-raised px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
              autoFocus
            />
          </label>

          {/* Working directory */}
          <div className="flex flex-col gap-1.5 text-xs text-ink-dim">
            <label className="flex flex-col gap-1" htmlFor="new-session-cwd-input">
              {t("sessions.sheetCwdLabel")}
            </label>
            <div className="flex gap-1.5">
              <input
                id="new-session-cwd-input"
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                data-testid="new-session-cwd"
                placeholder={defaultCwd}
                className="flex-1 rounded-md border border-line-strong bg-bg-raised px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setView("picker")}
                data-testid="new-session-cwd-browse"
                className="rounded-md border border-line bg-bg-raised px-3 py-2 text-xs text-ink-dim hover:border-line-strong hover:text-ink"
                title={t("sessions.browseTooltip")}
              >
                {t("sessions.browseLabel")}
              </button>
            </div>
            {recentCwds.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                <span className="py-1 text-[10px] text-ink-mute">{t("sessions.recentLabel")}</span>
                {recentCwds.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setCwd(entry)}
                    data-testid="new-session-recent-cwd"
                    className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                      cwd === entry
                        ? "border-accent/60 bg-accent/10 text-ink"
                        : "border-line bg-bg-raised text-ink-dim hover:border-line-strong hover:text-ink"
                    }`}
                    title={entry}
                  >
                    {truncatePath(entry, 32)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Command selector */}
          <div className="flex flex-col gap-2 text-xs text-ink-dim">
            <span>{t("sessions.sheetCommandLabel")}</span>
            <div className="flex flex-wrap gap-1.5">
              <CommandChip
                label={t("sessions.cmdNone")}
                selected={selection.kind === "none"}
                onClick={() => {
                  setSelection({ kind: "none" });
                  setFlags([]);
                }}
                testId="new-session-cmd-none"
              />
              {AGENT_PRESETS.map((p) => (
                <CommandChip
                  key={p.id}
                  label={p.label}
                  selected={selection.kind === "preset" && selection.presetId === p.id}
                  onClick={() => handlePresetClick(p.id)}
                  testId={`new-session-cmd-${p.id}`}
                />
              ))}
              {customCommands.map((c) => (
                <CommandChipRemovable
                  key={c.id}
                  label={c.label}
                  selected={selection.kind === "custom-library" && selection.id === c.id}
                  onClick={() => handleCustomLibraryClick(c.id)}
                  onRemove={() => {
                    removeCustomCommand(c.id);
                    if (selection.kind === "custom-library" && selection.id === c.id) {
                      setSelection({ kind: "none" });
                    }
                  }}
                  testId={`new-session-cmd-custom-${c.id}`}
                />
              ))}
              <CommandChip
                label={t("sessions.cmdCustom")}
                selected={selection.kind === "custom-new"}
                onClick={handleCustomNewClick}
                testId="new-session-cmd-custom-new"
              />
            </div>

            {/* Flag chips for preset commands */}
            {preset && preset.flags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                <span className="py-1 text-[10px] text-ink-mute">{t("sessions.flagsLabel")}</span>
                {preset.flags.map((flag) => (
                  <button
                    key={flag}
                    type="button"
                    onClick={() => toggleFlag(flag)}
                    data-testid={`new-session-flag-${flag}`}
                    aria-pressed={flags.includes(flag)}
                    className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                      flags.includes(flag)
                        ? "border-accent bg-accent/15 text-ink"
                        : "border-line bg-bg-raised text-ink-dim hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    {flag}
                  </button>
                ))}
              </div>
            )}

            {/* Custom command editor */}
            {selection.kind === "custom-new" && (
              <div className="flex flex-col gap-1.5 rounded-md border border-line bg-bg p-2">
                <input
                  type="text"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  data-testid="new-session-custom-cmd"
                  placeholder={t("sessions.customCmdPlaceholder")}
                  className="rounded-md border border-line-strong bg-bg-raised px-2 py-1.5 font-mono text-xs text-ink focus:border-accent focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    data-testid="new-session-custom-label"
                    placeholder={t("sessions.customLabelPlaceholder")}
                    className="flex-1 rounded-md border border-line-strong bg-bg-raised px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustom}
                    disabled={!customText.trim()}
                    data-testid="new-session-custom-save"
                    className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim hover:bg-bg-raised hover:text-ink disabled:opacity-40"
                  >
                    {t("sessions.saveCustom")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="rounded-md border border-line bg-bg px-3 py-2 font-mono text-[11px] text-ink-dim">
            <div className="text-[10px] text-ink-mute">{t("sessions.previewLabel")}</div>
            <div className="truncate text-ink">
              <span className="text-ink-mute">$</span>{" "}
              {cwd.trim() && cwd.trim() !== defaultCwd ? (
                <>
                  <span className="text-ink-mute">cd</span> {cwd.trim()}
                  {finalCommand ? " && " : ""}
                </>
              ) : null}
              {finalCommand ||
                (cwd.trim() && cwd.trim() !== defaultCwd ? (
                  ""
                ) : (
                  <span className="text-ink-mute">{t("sessions.shellPreviewHint")}</span>
                ))}
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-dim hover:bg-bg-raised hover:text-ink"
            >
              {t("files.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="new-session-submit"
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:bg-line-strong disabled:text-ink-mute"
            >
              {t("sessions.createButton")}
            </button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}

interface CommandChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  testId: string;
}

function CommandChip({ label, selected, onClick, testId }: CommandChipProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
        selected
          ? "border-accent bg-accent/15 text-ink"
          : "border-line bg-bg-raised text-ink-dim hover:border-line-strong hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

interface CommandChipRemovableProps extends CommandChipProps {
  onRemove: () => void;
}

function CommandChipRemovable({
  label,
  selected,
  onClick,
  onRemove,
  testId
}: CommandChipRemovableProps): ReactElement {
  return (
    <span
      className={`inline-flex items-stretch overflow-hidden rounded-md border text-xs ${
        selected
          ? "border-accent bg-accent/15"
          : "border-line bg-bg-raised hover:border-line-strong"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        data-testid={testId}
        className={`px-2.5 py-1 font-mono transition-colors ${
          selected ? "text-ink" : "text-ink-dim hover:text-ink"
        }`}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${label}`}
        className="border-l border-current/20 px-1.5 text-ink-mute transition-colors hover:text-ink"
      >
        ×
      </button>
    </span>
  );
}

const truncatePath = (p: string, max: number): string => {
  if (p.length <= max) return p;
  return `…${p.slice(-(max - 1))}`;
};

const serializeSelection = (sel: CommandSelection): string => {
  switch (sel.kind) {
    case "none":
      return "";
    case "preset":
      return `preset:${sel.presetId}`;
    case "custom-library":
      return `custom:${sel.id}`;
    case "custom-new":
      return "custom-new";
  }
};

const resolveSavedSelection = (
  saved: string,
  customCommands: CustomCommand[]
): CommandSelection => {
  if (!saved) return { kind: "none" };
  if (saved.startsWith("preset:")) {
    const id = saved.slice("preset:".length);
    if (AGENT_PRESETS.some((p) => p.id === id)) {
      return { kind: "preset", presetId: id };
    }
  }
  if (saved.startsWith("custom:")) {
    const id = saved.slice("custom:".length);
    if (customCommands.some((c) => c.id === id)) {
      return { kind: "custom-library", id };
    }
  }
  return { kind: "none" };
};
