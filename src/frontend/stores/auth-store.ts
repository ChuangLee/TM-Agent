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

const LEGACY_STORAGE_KEY = "tm-agent-password";

const clearStoredPassword = (): void => {
  try {
    globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
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

clearStoredPassword();

export const useAuthStore = create<AuthState>((set) => ({
  token: readTokenFromUrl(),
  password: "",
  passwordRequired: false,
  phase: "probing",
  errorMessage: "",
  clientId: "",
  setToken: (token) => set({ token }),
  setPassword: (password) => {
    clearStoredPassword();
    set({ password });
  },
  setPasswordRequired: (passwordRequired) => set({ passwordRequired }),
  setPhase: (phase) => set({ phase }),
  setError: (errorMessage) => set({ errorMessage, phase: "failed" }),
  setClientId: (clientId) => set({ clientId })
}));
