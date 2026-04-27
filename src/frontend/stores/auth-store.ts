import { create } from "zustand";

export type AuthPhase = "probing" | "needs-password" | "authenticating" | "authed" | "failed";

export interface AuthState {
  token: string;
  password: string;
  passwordRequired: boolean;
  phase: AuthPhase;
  errorMessage: string;
  clientId: string;
  setToken(token: string): void;
  setPassword(password: string): void;
  setPasswordRequired(required: boolean): void;
  setPhase(phase: AuthPhase): void;
  setError(message: string): void;
  setClientId(clientId: string): void;
}

const STORAGE_KEY = "tm-agent-password";
const OLD_STORAGE_KEY = "agent-tmux-password";

const readStoredPassword = (): string => {
  try {
    const current = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (current) return current;

    const old = globalThis.localStorage?.getItem(OLD_STORAGE_KEY);
    if (old) {
      globalThis.localStorage?.setItem(STORAGE_KEY, old);
      globalThis.localStorage?.removeItem(OLD_STORAGE_KEY);
      return old;
    }
    return "";
  } catch {
    return "";
  }
};

const writeStoredPassword = (password: string): void => {
  try {
    if (password) {
      globalThis.localStorage?.setItem(STORAGE_KEY, password);
    } else {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    }
    globalThis.localStorage?.removeItem(OLD_STORAGE_KEY);
  } catch {
    // ignore storage failures (private mode, quota)
  }
};

const readTokenFromUrl = (): string => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get("token") ?? "";
  } catch {
    return "";
  }
};

export const useAuthStore = create<AuthState>((set) => ({
  token: readTokenFromUrl(),
  password: readStoredPassword(),
  passwordRequired: false,
  phase: "probing",
  errorMessage: "",
  clientId: "",
  setToken: (token) => set({ token }),
  setPassword: (password) => {
    writeStoredPassword(password);
    set({ password });
  },
  setPasswordRequired: (passwordRequired) => set({ passwordRequired }),
  setPhase: (phase) => set({ phase }),
  setError: (errorMessage) => set({ errorMessage, phase: "failed" }),
  setClientId: (clientId) => set({ clientId })
}));
