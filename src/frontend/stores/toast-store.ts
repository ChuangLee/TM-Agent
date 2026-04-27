import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

export interface ToastStoreState {
  toasts: Toast[];
  push(toast: Omit<Toast, "id"> & { id?: string; durationMs?: number }): void;
  dismiss(id: string): void;
}

const DEFAULT_DURATION_MS = 2500;

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id =
      toast.id ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    set((s) => ({ toasts: [...s.toasts, { id, kind: toast.kind, message: toast.message }] }));
    const duration = toast.durationMs ?? DEFAULT_DURATION_MS;
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}));
