import type { BufferLineLike } from "../../lib/ansi/index.js";
import { renderBufferLine } from "../../lib/ansi/index.js";
import { debugLog } from "../../lib/debug-log.js";

export interface RowWindow {
  topLine: number;
  visibleRows: number;
  cols: number;
  bufferLength: number;
  cursor: { x: number; y: number; visible: boolean };
  getLine: (y: number) => BufferLineLike | undefined;
}

export interface DomRendererDeps {
  rows: HTMLElement;
  cursor: HTMLElement;
  cellWidthPx: number;
  cellHeightPx: number;
  getWindow: () => RowWindow;
}

/**
 * Reconciles the visible buffer window to a flat list of `.tm-row` children.
 * Replaces the dual xterm-DOM + mirror rendering from ADR-0004 with a single
 * React-owned tree (ADR-0005). Row diff is line-by-line HTML — acceptable
 * because the visible window is small (tens of rows) and the ANSI renderer
 * coalesces SGR runs.
 */
export class DomRenderer {
  private rowEls: HTMLDivElement[] = [];
  private rowHtml: string[] = [];
  private currentRowCount = 0;

  public constructor(private readonly deps: DomRendererDeps) {}

  public update(): void {
    const win = this.deps.getWindow();
    if (win.visibleRows !== this.currentRowCount) {
      this.rebuildRows(win.visibleRows);
    }
    let changed = 0;
    for (let r = 0; r < win.visibleRows; r++) {
      const y = win.topLine + r;
      const line = y >= 0 && y < win.bufferLength ? win.getLine(y) : undefined;
      const html = line ? renderBufferLine(line, win.cols) : "";
      if (this.rowHtml[r] !== html) {
        this.rowEls[r].innerHTML = html === "" ? "&nbsp;" : html;
        this.rowHtml[r] = html;
        changed++;
      }
    }
    this.updateCursor(win);
    debugLog("render", "update", {
      visibleRows: win.visibleRows,
      topLine: win.topLine,
      bufferLength: win.bufferLength,
      cols: win.cols,
      changed,
      cursorY: win.cursor.y
    });
  }

  public destroy(): void {
    this.deps.rows.textContent = "";
    this.rowEls = [];
    this.rowHtml = [];
    this.currentRowCount = 0;
  }

  /**
   * Drop the rowHtml diff cache so the next `update()` repaints every row
   * unconditionally. Call this whenever the underlying buffer has been
   * reflowed or reset in a way that keeps the same line count but mutates
   * each line's content — e.g., after `term.resize()` changes cols and
   * xterm reflows wrapping — because otherwise the cache sees "38 rows
   * unchanged" and the DOM stays pinned to pre-reflow HTML until the next
   * `term.write()` lands. Users see stale rendering that "fixes itself"
   * the moment any new byte arrives.
   */
  public invalidate(): void {
    for (let i = 0; i < this.rowHtml.length; i++) {
      this.rowHtml[i] = "\u0000";
    }
    debugLog("render", "invalidate", { rowCount: this.rowHtml.length });
  }

  private updateCursor(win: RowWindow): void {
    const cur = this.deps.cursor;
    const absY = win.cursor.y;
    const visibleRow = absY - win.topLine;
    const onScreen = win.cursor.visible && visibleRow >= 0 && visibleRow < win.visibleRows;
    if (!onScreen) {
      cur.style.display = "none";
      return;
    }
    cur.style.display = "";
    cur.style.transform = `translate(${win.cursor.x * this.deps.cellWidthPx}px, ${
      visibleRow * this.deps.cellHeightPx
    }px)`;
    cur.style.width = `${this.deps.cellWidthPx}px`;
    cur.style.height = `${this.deps.cellHeightPx}px`;
  }

  private rebuildRows(count: number): void {
    const doc = this.deps.rows.ownerDocument ?? document;
    this.deps.rows.textContent = "";
    this.rowEls = [];
    this.rowHtml = [];
    for (let i = 0; i < count; i++) {
      const div = doc.createElement("div");
      div.className = "tm-row";
      div.innerHTML = "&nbsp;";
      this.deps.rows.appendChild(div);
      this.rowEls.push(div);
      this.rowHtml.push("");
    }
    this.currentRowCount = count;
  }
}
