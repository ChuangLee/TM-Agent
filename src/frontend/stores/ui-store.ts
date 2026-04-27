import { create } from "zustand";

const SIDEBAR_KEY = "tm-agent:sidebarCollapsed";

const readInitialCollapsed = (): boolean => {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // localStorage unavailable — fall through.
  }
  // Heuristic: narrow desktops default to collapsed. Mobile never renders the
  // sidebar so this only matters at ≥ 820 px viewports.
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(max-width: 1024px)").matches;
  }
  return false;
};

const persistCollapsed = (value: boolean): void => {
  try {
    localStorage.setItem(SIDEBAR_KEY, value ? "1" : "0");
  } catch {
    // Ignore — behavior still works, just no persistence.
  }
};

export interface UiState {
  keyboardInset: number;
  setKeyboardInset(px: number): void;
  sidebarCollapsed: boolean;
  toggleSidebar(): void;
  setSidebarCollapsed(value: boolean): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  keyboardInset: 0,
  setKeyboardInset: (keyboardInset) => set({ keyboardInset }),
  sidebarCollapsed: readInitialCollapsed(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    persistCollapsed(next);
    set({ sidebarCollapsed: next });
  },
  setSidebarCollapsed: (value) => {
    persistCollapsed(value);
    set({ sidebarCollapsed: value });
  }
}));
