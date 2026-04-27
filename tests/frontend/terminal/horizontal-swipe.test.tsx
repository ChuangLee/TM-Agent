// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useHorizontalSwipe } from "../../../src/frontend/features/terminal/use-horizontal-swipe.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface PointerInit {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  pointerType?: string;
}

const pointer = (type: string, init: PointerInit = {}): Event => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, {
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    pointerType: init.pointerType ?? "touch"
  });
  return ev;
};

function Harness({
  onSwipe,
  targetRef
}: {
  onSwipe: (dir: "left" | "right") => void;
  targetRef: React.RefObject<HTMLDivElement | null>;
}): React.ReactElement {
  useHorizontalSwipe(targetRef, {
    onSwipe,
    axisDecisionPx: 10,
    commitPx: 50,
    verticalLockoutPx: 8
  });
  return <div ref={targetRef} data-testid="swipe-target" />;
}

describe("useHorizontalSwipe", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  const mount = async (onSwipe: (dir: "left" | "right") => void) => {
    const ref = createRef<HTMLDivElement>();
    await act(async () => {
      root.render(<Harness onSwipe={onSwipe} targetRef={ref} />);
    });
    return ref.current!;
  };

  test("fires left when drag travels far left on a mostly-horizontal axis", async () => {
    const onSwipe = vi.fn();
    const el = await mount(onSwipe);
    el.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 84, clientY: 101 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 102 }));
    expect(onSwipe).toHaveBeenCalledWith("left");
  });

  test("fires right when drag travels far right", async () => {
    const onSwipe = vi.fn();
    const el = await mount(onSwipe);
    el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 20, clientY: 1 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 60, clientY: 2 }));
    expect(onSwipe).toHaveBeenCalledWith("right");
  });

  test("releases to native scroll when vertical wins early", async () => {
    const onSwipe = vi.fn();
    const el = await mount(onSwipe);
    el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 2, clientY: 30 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 70, clientY: 40 }));
    expect(onSwipe).not.toHaveBeenCalled();
  });

  test("scroll event mid-gesture forces release", async () => {
    const onSwipe = vi.fn();
    const el = await mount(onSwipe);
    el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 20, clientY: 0 }));
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    el.dispatchEvent(pointer("pointermove", { clientX: 80, clientY: 0 }));
    expect(onSwipe).not.toHaveBeenCalled();
  });

  test("fires at most once per gesture", async () => {
    const onSwipe = vi.fn();
    const el = await mount(onSwipe);
    el.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 20, clientY: 0 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 70, clientY: 0 }));
    el.dispatchEvent(pointer("pointermove", { clientX: 120, clientY: 0 }));
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });
});
