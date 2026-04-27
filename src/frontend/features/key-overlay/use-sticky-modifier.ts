import { useCallback, useRef, useState } from "react";

export type ModifierKey = "ctrl" | "alt" | "shift" | "meta";
export type ModifierState = "idle" | "armed" | "locked";
export type ModifierStateMap = Record<ModifierKey, ModifierState>;

const INITIAL: ModifierStateMap = {
  ctrl: "idle",
  alt: "idle",
  shift: "idle",
  meta: "idle"
};

export interface UseStickyModifiersResult {
  state: ModifierStateMap;
  tap(k: ModifierKey): void;
  longPress(k: ModifierKey): void;
  /**
   * Fire when a non-modifier key is pressed. Returns all currently-active
   * modifiers (armed + locked), auto-releases armed ones to idle, keeps
   * locked ones locked.
   */
  consume(): ModifierKey[];
}

function nextOnTap(cur: ModifierState): ModifierState {
  if (cur === "idle") return "armed";
  return "idle";
}
function nextOnLongPress(cur: ModifierState): ModifierState {
  if (cur === "locked") return "idle";
  return "locked";
}

export function useStickyModifiers(): UseStickyModifiersResult {
  const [state, setState] = useState<ModifierStateMap>(INITIAL);
  // Shadow ref so `consume()` can read the latest state synchronously —
  // React 18's setState updater runs during reconciliation, after the
  // call returns, so we'd otherwise miss modifiers set in the same tick.
  const stateRef = useRef<ModifierStateMap>(INITIAL);

  const commit = useCallback((next: ModifierStateMap): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  const tap = useCallback(
    (k: ModifierKey): void => {
      const cur = stateRef.current;
      commit({ ...cur, [k]: nextOnTap(cur[k]) });
    },
    [commit]
  );

  const longPress = useCallback(
    (k: ModifierKey): void => {
      const cur = stateRef.current;
      commit({ ...cur, [k]: nextOnLongPress(cur[k]) });
    },
    [commit]
  );

  const consume = useCallback((): ModifierKey[] => {
    const cur = stateRef.current;
    const active: ModifierKey[] = [];
    const next: ModifierStateMap = { ...cur };
    for (const k of ["ctrl", "alt", "shift", "meta"] as const) {
      if (cur[k] === "armed" || cur[k] === "locked") active.push(k);
      if (cur[k] === "armed") next[k] = "idle";
    }
    commit(next);
    return active;
  }, [commit]);

  return { state, tap, longPress, consume };
}
