import type { ReactElement } from "react";
import { useToastStore } from "../stores/toast-store.js";

/**
 * Bottom-right floating toast queue. Each toast auto-dismisses after its
 * duration (default 2.5s) but users can also tap to dismiss early. Mobile
 * safe-area-aware so the toast doesn't slide under the home-indicator.
 */
export function Toaster(): ReactElement {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      data-testid="toaster"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[1200] flex flex-col items-center gap-2 px-4 md:bottom-6 md:right-6 md:left-auto md:items-end md:px-0"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          data-unstyled
          onClick={() => dismiss(toast.id)}
          data-testid="toast"
          data-kind={toast.kind}
          className={`tm-toast pointer-events-auto max-w-sm rounded-lg border px-3 py-2 text-left text-sm shadow-xl backdrop-blur-md ${
            toast.kind === "success"
              ? "border-ok/40 bg-ok/15 text-ink"
              : toast.kind === "error"
                ? "border-err/40 bg-err/15 text-ink"
                : "border-line bg-bg-elev/85 text-ink"
          }`}
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
