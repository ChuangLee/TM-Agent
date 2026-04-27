import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/auth-store.js";
import { useTerminalStore } from "../stores/terminal-store.js";
import { useUiStore } from "../stores/ui-store.js";
import { useControlSession } from "../hooks/use-control-session.js";
import { useSlotFocusShortcuts } from "../hooks/use-slot-focus-shortcuts.js";
import { useFilePanelPrefetch } from "../features/files/use-file-panel.js";
import { useVisualViewportInset } from "../hooks/use-visual-viewport-inset.js";
import { fetchServerConfig } from "../services/config-api.js";
import { hasPasswordSession } from "../services/auth-api.js";
import { useServerConfigStore } from "../stores/server-config-store.js";
import { TopBar } from "../features/shell/TopBar.js";
import { MultiSurface } from "../features/terminal/MultiSurface.js";
import { useLayoutStore } from "../stores/layout-store.js";
import { ComposeBar } from "../features/compose/ComposeBar.js";
import { ComposeFocusIndicator } from "../features/compose/ComposeFocusIndicator.js";
import { PasswordPrompt } from "../features/auth/PasswordPrompt.js";
import { SessionDrawer } from "../features/sessions/SessionDrawer.js";
import { Sidebar } from "../features/sessions/Sidebar.js";
import { SheetHost } from "../features/sessions/SheetHost.js";
import { WindowStrip } from "../features/sessions/WindowStrip.js";
import { Toaster } from "../components/Toaster.js";
import { selectAttachedBaseState, useSessionsStore } from "../stores/sessions-store.js";
import { PromptCaptureBanner } from "../features/action-panel/PromptCaptureBanner.js";
import { KeyOverlay } from "../features/key-overlay/KeyOverlay.js";
import { useComposeBridge } from "../features/compose/compose-bridge.js";
import { useDirectMode } from "../features/direct-mode/use-direct-mode.js";
import { DirectModeIndicator } from "../features/direct-mode/DirectModeIndicator.js";
import { ImeBridge } from "../features/direct-mode/ImeBridge.js";
import { FileViewer } from "../features/files/FileViewer.js";

const DESKTOP_QUERY = "(min-width: 768px)";

export function App(): ReactElement {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const password = useAuthStore((s) => s.password);
  const phase = useAuthStore((s) => s.phase);
  const errorMessage = useAuthStore((s) => s.errorMessage);
  const passwordRequired = useAuthStore((s) => s.passwordRequired);
  const setPhase = useAuthStore((s) => s.setPhase);
  const setPasswordRequired = useAuthStore((s) => s.setPasswordRequired);
  const setError = useAuthStore((s) => s.setError);

  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);

  useVisualViewportInset();

  useEffect(() => {
    if (phase !== "probing") return;
    if (!token) {
      setError("Missing token in URL");
      return;
    }
    void fetchServerConfig()
      .then(async (config) => {
        setPasswordRequired(config.passwordRequired);
        if (config.workspaceRoot) {
          useServerConfigStore.getState().setWorkspaceRoot(config.workspaceRoot);
        }
        if (!config.passwordRequired) {
          setPhase("authenticating");
          return;
        }
        if (password) {
          setPhase("authenticating");
          return;
        }
        if (await hasPasswordSession(token)) {
          setPhase("authenticating");
        } else {
          setPhase("needs-password");
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
  }, [phase, token, password, setError, setPasswordRequired, setPhase]);

  const { send } = useControlSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const selectSession = useCallback(
    (session: string): void => {
      // Sidebar / drawer pick targets the focused slot. In single-mode
      // (the legacy slot-0-only world) we still dispatch select_session
      // ourselves because slot 0 in single mode is on the auto-attach
      // path and SlotFrame won't issue it. In multi-slot modes the
      // SlotFrame's effect picks up the layout-store change and emits
      // select_session itself, so we'd double-dispatch from here.
      const layout = useLayoutStore.getState();
      const focused = layout.focusedSlot;
      const isSingleSlot0 = layout.mode === 1 && focused === 0;

      // Close the terminal-WS gate on the SAME tick the request leaves.
      // tmux attach's initial redraw can race ahead of term.reset()
      // otherwise (see use-terminal §session-switch-gate).
      useTerminalStore.getState().beginSessionSwitch(focused);
      useLayoutStore.getState().attachToSlot(focused, session);
      if (isSingleSlot0) {
        send({ type: "select_session", session, slot: focused });
      }
    },
    [send]
  );

  // Ctrl/⌘+B toggles the desktop sidebar (architecture §3.4). On mobile the
  // sidebar isn't rendered, so the same chord toggles the drawer instead.
  // Alt+←/→ steps through windows of the attached session.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const inTextInput = target && /^(INPUT|TEXTAREA)$/.test(target.tagName);

      if ((e.key === "b" || e.key === "B") && (e.ctrlKey || e.metaKey)) {
        if (e.altKey || e.shiftKey) return;
        if (inTextInput) return;
        e.preventDefault();
        const desktop = typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches;
        if (desktop) {
          toggleSidebar();
        } else {
          setDrawerOpen((open) => !open);
        }
        return;
      }

      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (inTextInput) return;
        const state = useSessionsStore.getState();
        const base = selectAttachedBaseState(state.snapshot, state.attachedBaseSession);
        if (!base || base.windowStates.length < 2) return;
        const sorted = [...base.windowStates].sort((a, b) => a.index - b.index);
        const activeIdx = sorted.findIndex((w) => w.active);
        if (activeIdx < 0) return;
        const nextIdx =
          e.key === "ArrowLeft"
            ? (activeIdx - 1 + sorted.length) % sorted.length
            : (activeIdx + 1) % sorted.length;
        const target = sorted[nextIdx];
        if (!target) return;
        e.preventDefault();
        send({
          type: "select_window",
          session: base.name,
          windowIndex: target.index
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, send]);

  const directMode = useDirectMode({
    onSendBytes: (bytes) => {
      const slot = useLayoutStore.getState().focusedSlot;
      send({ type: "send_raw", bytes, slot });
    }
  });

  useSlotFocusShortcuts();
  useFilePanelPrefetch();

  if (phase === "probing" || phase === "authenticating") {
    return (
      <main className="flex h-full items-center justify-center px-6">
        <p className="text-sm text-ink-dim">
          {phase === "probing" ? "probing backend…" : "authenticating…"}
        </p>
      </main>
    );
  }

  if (phase === "failed") {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold text-ink">TM-Agent</h1>
        <p className="max-w-sm text-sm text-err">{errorMessage}</p>
        {passwordRequired && (
          <button
            type="button"
            onClick={() => setPhase("needs-password")}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg"
          >
            Re-enter password
          </button>
        )}
      </main>
    );
  }

  if (phase === "needs-password") {
    return <PasswordPrompt />;
  }

  const sendBytes = (payload: string): void => {
    if (!payload) return;
    const slot = useLayoutStore.getState().focusedSlot;
    send({ type: "send_raw", bytes: payload, slot });
  };

  // Pill click: on mobile open the drawer; on desktop (collapsed rail) expand
  // the sidebar. The pill only renders when the sidebar is not already
  // expanded, so it never needs to "collapse back" here.
  const handleSessionPill = (): void => {
    const desktop = typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches;
    if (desktop) {
      setSidebarCollapsed(false);
    } else {
      setDrawerOpen(true);
    }
  };

  const gridCols = sidebarCollapsed
    ? "md:grid-cols-[56px_1fr]"
    : "md:grid-cols-[minmax(240px,272px)_1fr]";

  const handleSelectWindow = (windowIndex: number): void => {
    const state = useSessionsStore.getState();
    const base = selectAttachedBaseState(state.snapshot, state.attachedBaseSession);
    if (!base) return;
    send({ type: "select_window", session: base.name, windowIndex });
  };
  const handleNewWindow = (): void => {
    const state = useSessionsStore.getState();
    const base = selectAttachedBaseState(state.snapshot, state.attachedBaseSession);
    if (!base) return;
    send({ type: "new_window", session: base.name });
  };

  return (
    <div
      className={`grid h-full grid-rows-[auto_auto_auto_1fr_auto] ${gridCols} md:[grid-template-areas:'sidebar_topbar''sidebar_windows''sidebar_actions''sidebar_main''sidebar_compose']`}
      data-sidebar-state={sidebarCollapsed ? "collapsed" : "expanded"}
    >
      <aside data-dm-blur className="hidden overflow-hidden md:block md:[grid-area:sidebar]">
        <Sidebar onSelect={selectSession} />
      </aside>
      <div data-dm-blur className="md:[grid-area:topbar]">
        <TopBar
          onRequestSessionDrawer={handleSessionPill}
          onToggleKeyOverlay={() => setOverlayOpen((o) => !o)}
          keyOverlayOpen={overlayOpen}
          sidebarExpanded={!sidebarCollapsed}
          rightExtras={undefined}
        />
      </div>
      <div data-dm-blur className="md:[grid-area:windows]">
        <WindowStrip onSelect={handleSelectWindow} onNewWindow={handleNewWindow} />
      </div>
      <div data-dm-blur className="md:[grid-area:actions]">
        <PromptCaptureBanner
          onSend={sendBytes}
          onSendSecret={sendBytes}
          onCancel={() => sendBytes("\x03")}
        />
      </div>
      <KeyOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        onSend={(bytes) => sendBytes(bytes)}
        onOpenCompose={() => {
          setOverlayOpen(false);
          useComposeBridge.getState().focus();
        }}
      />
      <DirectModeIndicator status={directMode.status} onExit={() => directMode.exit("indicator")} />
      <ImeBridge
        active={directMode.active}
        onCompositionDone={(text) => {
          const slot = useLayoutStore.getState().focusedSlot;
          send({ type: "send_raw", bytes: text, slot });
        }}
      />
      {/*
        `main` cell is `relative` so FileViewer can overlay the Surface (the
        xterm area). FileViewer renders null when no target — zero cost when
        the user isn't browsing files.
      */}
      <div className="relative min-h-0 md:[grid-area:main]">
        <MultiSurface send={send} />
        <FileViewer />
      </div>
      {/*
        Compose slot is a FIXED-HEIGHT relative container with the ComposeBar
        absolutely positioned at bottom:0. This decouples the grid row from
        the ComposeBar's actual height — when the user presses Shift+Enter,
        pastes multi-line text, or adds attachments, the ComposeBar grows
        *upward* overlaying the Surface instead of pushing the `1fr` main row
        which would trigger a cascade: grid reflow → Surface resize observer
        → xterm resize → tmux SIGWINCH → full redraw. The floating overlay
        also makes the expansion visually obvious vs. silently stealing rows
        from the shell. See ADR-0012 §6 "Overflow-up". ~72px matches the base
        layout height (paste button + single-row textarea + borders/padding).
      */}
      <div data-dm-blur className="relative md:[grid-area:compose]" style={{ height: 72 }}>
        <div className="absolute inset-x-0 bottom-0">
          <ComposeFocusIndicator />
          <ComposeBar
            onSend={(text) => {
              const slot = useLayoutStore.getState().focusedSlot;
              send({ type: "send_compose", text, slot });
            }}
            keyOverlayOpen={overlayOpen}
            trailingActions={
              directMode.available ? (
                <button
                  type="button"
                  onClick={directMode.toggle}
                  data-testid="compose-direct-mode"
                  className={
                    "inline-flex h-10 items-center rounded-lg px-3 text-xs font-semibold " +
                    (directMode.active
                      ? "bg-accent text-bg"
                      : "border border-line text-ink hover:bg-bg-elev")
                  }
                  aria-pressed={directMode.active}
                  aria-label={directMode.active ? t("directMode.exit") : t("directMode.enter")}
                  title={directMode.active ? t("directMode.exitTooltip") : t("directMode.enter")}
                >
                  {directMode.active ? t("directMode.toggleOn") : t("directMode.toggleOff")}
                </button>
              ) : undefined
            }
          />
        </div>
      </div>
      <SessionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelect={selectSession}
      />
      <SheetHost send={send} />
      <Toaster />
    </div>
  );
}
