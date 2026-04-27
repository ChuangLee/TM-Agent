import type { ReactElement } from "react";
import type { ControlClientMessage } from "../../../shared/protocol.js";
import { selectAttachedBaseState, useSessionsStore } from "../../stores/sessions-store.js";
import { useSheetStore } from "../../stores/sheet-store.js";
import { useToastStore } from "../../stores/toast-store.js";
import { NewSessionSheet } from "./NewSessionSheet.js";
import { RenameSheet } from "./RenameSheet.js";
import { SessionActionsSheet } from "./SessionActionsSheet.js";
import { WindowActionsSheet } from "./WindowActionsSheet.js";

export interface SheetHostProps {
  send: (message: ControlClientMessage) => void;
}

/**
 * Central coordinator for the session/window action + rename bottom sheets.
 * Reads the single `sheet-store` slot and renders the matching sheet; each
 * sheet hands its "submit" event back here to dispatch the right control
 * message. Keeping this in one file means App.tsx doesn't need to know
 * about individual sheets — it just mounts SheetHost once.
 */
export function SheetHost({ send }: SheetHostProps): ReactElement {
  const active = useSheetStore((s) => s.active);
  const open = useSheetStore((s) => s.open);
  const close = useSheetStore((s) => s.close);

  const snapshot = useSessionsStore((s) => s.snapshot);
  const attachedBase = useSessionsStore((s) => s.attachedBaseSession);
  const baseState = selectAttachedBaseState(snapshot, attachedBase);
  const toast = useToastStore((s) => s.push);

  return (
    <>
      <SessionActionsSheet
        open={active.kind === "session-actions"}
        onClose={close}
        session={active.kind === "session-actions" ? active.session : ""}
        onRename={() => {
          if (active.kind !== "session-actions") return;
          open({ kind: "rename-session", session: active.session });
        }}
        onKill={() => {
          if (active.kind !== "session-actions") return;
          send({ type: "kill_session", session: active.session });
          toast({
            kind: "info",
            message: `Killed session ${active.session}`
          });
          close();
        }}
      />
      <RenameSheet
        open={active.kind === "rename-session"}
        onClose={close}
        title={active.kind === "rename-session" ? `Rename session: ${active.session}` : ""}
        label="New session name"
        currentName={active.kind === "rename-session" ? active.session : ""}
        onSubmit={(newName) => {
          if (active.kind !== "rename-session") return;
          send({
            type: "rename_session",
            session: active.session,
            newName
          });
          toast({
            kind: "success",
            message: `Renamed ${active.session} → ${newName}`
          });
          close();
        }}
      />
      <NewSessionSheet
        open={active.kind === "new-session"}
        onClose={close}
        onSubmit={(form) => {
          // When an empty multi-slot picker triggered this sheet,
          // `active.slot` names the target slot so the new session lands
          // there instead of the implicit slot 0 (ADR-0013).
          const slot = active.kind === "new-session" ? active.slot : undefined;
          send({
            type: "new_session",
            name: form.name,
            ...(slot !== undefined && { slot }),
            ...(form.cwd !== undefined && { cwd: form.cwd }),
            ...(form.startupCommand !== undefined && {
              startupCommand: form.startupCommand
            })
          });
          toast({
            kind: "success",
            message: form.startupCommand
              ? `Created ${form.name} · ${form.startupCommand}`
              : `Created session ${form.name}`
          });
          close();
        }}
      />
      <WindowActionsSheet
        open={active.kind === "window-actions"}
        onClose={close}
        session={active.kind === "window-actions" ? active.session : ""}
        windowIndex={active.kind === "window-actions" ? active.windowIndex : 0}
        windowName={active.kind === "window-actions" ? active.windowName : ""}
        onRename={() => {
          if (active.kind !== "window-actions") return;
          open({
            kind: "rename-window",
            session: active.session,
            windowIndex: active.windowIndex,
            currentName: active.windowName
          });
        }}
        onKill={() => {
          if (active.kind !== "window-actions") return;
          // Guard: refuse to kill the last window of the attached session —
          // tmux would kill the session too, which is almost certainly not
          // what the user meant from a "rename window" menu.
          if (
            baseState &&
            baseState.name === active.session &&
            baseState.windowStates.length <= 1
          ) {
            return;
          }
          send({
            type: "kill_window",
            session: active.session,
            windowIndex: active.windowIndex
          });
          toast({
            kind: "info",
            message: `Killed window ${active.windowName}`
          });
          close();
        }}
      />
      <RenameSheet
        open={active.kind === "rename-window"}
        onClose={close}
        title={active.kind === "rename-window" ? `Rename window ${active.windowIndex}` : ""}
        label="New window name"
        currentName={active.kind === "rename-window" ? active.currentName : ""}
        onSubmit={(newName) => {
          if (active.kind !== "rename-window") return;
          send({
            type: "rename_window",
            session: active.session,
            windowIndex: active.windowIndex,
            newName
          });
          toast({
            kind: "success",
            message: `Renamed window → ${newName}`
          });
          close();
        }}
      />
    </>
  );
}
