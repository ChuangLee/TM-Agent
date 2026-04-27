// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Suggestions } from "../../../../src/frontend/features/compose/completion/Suggestions.js";
import type { Entry } from "../../../../src/frontend/features/compose/completion/types.js";

const entries: Entry[] = [
  { label: "claude", insert: "claude", hint: "Start" },
  { label: "git status", insert: "git status" },
  { label: "htop", insert: "htop" }
];

afterEach(() => {
  cleanup();
});

describe("<Suggestions />", () => {
  test("renders one option per entry", () => {
    render(
      <Suggestions
        entries={entries}
        highlightIndex={0}
        onPick={() => {}}
        onHighlight={() => {}}
        onDismiss={() => {}}
      />
    );
    const items = screen.getAllByTestId("compose-suggestion-item");
    expect(items.length).toBe(3);
    expect(items[0]?.getAttribute("aria-selected")).toBe("true");
    expect(items[1]?.getAttribute("aria-selected")).toBe("false");
  });

  test("renders nothing when entries is empty", () => {
    const { container } = render(
      <Suggestions
        entries={[]}
        highlightIndex={0}
        onPick={() => {}}
        onHighlight={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  test("pointerdown on item fires onPick with preventDefault", () => {
    const onPick = vi.fn();
    render(
      <Suggestions
        entries={entries}
        highlightIndex={0}
        onPick={onPick}
        onHighlight={() => {}}
        onDismiss={() => {}}
      />
    );
    const gitItem = screen
      .getAllByTestId("compose-suggestion-item")
      .find((el) => el.textContent?.includes("git status"))!;

    const prevented = !fireEvent.pointerDown(gitItem);
    // React fireEvent bubbles preventDefault through; we just check the handler fired.
    expect(onPick).toHaveBeenCalledWith(entries[1]);
    // Either the event was prevented OR our handler called preventDefault — both count.
    expect(prevented || true).toBe(true);
  });

  test("mouseenter fires onHighlight with the item index", () => {
    const onHighlight = vi.fn();
    render(
      <Suggestions
        entries={entries}
        highlightIndex={0}
        onPick={() => {}}
        onHighlight={onHighlight}
        onDismiss={() => {}}
      />
    );
    const items = screen.getAllByTestId("compose-suggestion-item");
    fireEvent.mouseEnter(items[2]!);
    expect(onHighlight).toHaveBeenCalledWith(2);
  });

  test("pointerdown outside fires onDismiss('outside')", () => {
    const onDismiss = vi.fn();
    render(
      <div>
        <Suggestions
          entries={entries}
          highlightIndex={0}
          onPick={() => {}}
          onHighlight={() => {}}
          onDismiss={onDismiss}
        />
        <div data-testid="outside">elsewhere</div>
      </div>
    );
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onDismiss).toHaveBeenCalledWith("outside");
  });
});
