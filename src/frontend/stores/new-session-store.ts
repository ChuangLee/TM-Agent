import { create } from "zustand";

/**
 * ADR-0014: localStorage-backed state for the NewSessionSheet wizard.
 *
 *  - recentCwds: dedup-LRU of working directories the user has actually
 *    submitted, cap 5. Surfaces as a datalist / dropdown above the cwd input.
 *  - customCommands: user-added commands that appear at the top of the
 *    command selector, alongside the built-in agent presets.
 *  - lastForm: the most recently submitted wizard values (name excluded),
 *    used to prefill the next time the sheet opens.
 */

const LS_RECENT = "tm-agent.new-session.recent-cwds";
const LS_CUSTOM = "tm-agent.new-session.custom-commands";
const LS_LAST = "tm-agent.new-session.last";
const MAX_RECENT = 5;

export interface CustomCommand {
  id: string;
  label: string;
  command: string;
}

export interface LastForm {
  cwd: string;
  command: string;
  flags: string[];
}

interface Persisted {
  recentCwds: string[];
  customCommands: CustomCommand[];
  lastForm: LastForm | null;
}

interface NewSessionStoreState extends Persisted {
  addRecentCwd(cwd: string): void;
  addCustomCommand(label: string, command: string): CustomCommand;
  removeCustomCommand(id: string): void;
  rememberLast(form: LastForm): void;
}

const readArray = <T>(key: string, fallback: T[]): T[] => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
};

const readLast = (): LastForm | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_LAST);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastForm> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
      command: typeof parsed.command === "string" ? parsed.command : "",
      flags: Array.isArray(parsed.flags)
        ? parsed.flags.filter((f): f is string => typeof f === "string")
        : []
    };
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / private mode — silently ignore; wizard still works
    // in-session, just doesn't survive reload.
  }
};

// Dedup while preserving first-seen order after prepending `cwd`.
export const pushRecent = (list: string[], cwd: string): string[] => {
  const trimmed = cwd.trim();
  if (!trimmed) return list;
  const without = list.filter((entry) => entry !== trimmed);
  return [trimmed, ...without].slice(0, MAX_RECENT);
};

export const useNewSessionStore = create<NewSessionStoreState>((set, get) => ({
  recentCwds: readArray<string>(LS_RECENT, []),
  customCommands: readArray<CustomCommand>(LS_CUSTOM, []),
  lastForm: readLast(),

  addRecentCwd: (cwd) => {
    const next = pushRecent(get().recentCwds, cwd);
    set({ recentCwds: next });
    writeJson(LS_RECENT, next);
  },

  addCustomCommand: (label, command) => {
    const entry: CustomCommand = {
      id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim() || command.trim(),
      command: command.trim()
    };
    const next = [entry, ...get().customCommands.filter((c) => c.command !== entry.command)];
    set({ customCommands: next });
    writeJson(LS_CUSTOM, next);
    return entry;
  },

  removeCustomCommand: (id) => {
    const next = get().customCommands.filter((c) => c.id !== id);
    set({ customCommands: next });
    writeJson(LS_CUSTOM, next);
  },

  rememberLast: (form) => {
    set({ lastForm: form });
    writeJson(LS_LAST, form);
  }
}));
