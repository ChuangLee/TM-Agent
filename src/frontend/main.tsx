import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import { App } from "./app/App";
import { useAuthStore } from "./stores/auth-store.js";
import { useShellStateStore } from "./stores/shell-state-store.js";
import { useSessionsStore } from "./stores/sessions-store.js";
import { useTerminalStore } from "./stores/terminal-store.js";
import { useUiStore } from "./stores/ui-store.js";
import "./styles/app.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("root element not found");
}

// Debug bridge — scripts/debug-*.mjs and the devtools console read zustand
// state through this handle instead of walking React fibers. Read-only by
// convention; writes still go through the usual store API.
(globalThis as unknown as { __TM_AGENT_STORES__: unknown }).__TM_AGENT_STORES__ = {
  auth: useAuthStore,
  shellState: useShellStateStore,
  sessions: useSessionsStore,
  terminal: useTerminalStore,
  ui: useUiStore
};

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
