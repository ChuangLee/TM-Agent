import { buildSnapshot } from "../tmux/types.js";
import type { TmuxStateSnapshot } from "../../shared/protocol.js";
import type { TmuxGateway } from "../tmux/types.js";

export class TmuxStateMonitor {
  private timer?: NodeJS.Timeout;
  private lastSerializedState?: string;
  private cachedSnapshot?: TmuxStateSnapshot;
  private running = false;
  /** Bumped on every publishSnapshot(true) so in-flight ticks can detect staleness. */
  private forceGeneration = 0;
  /**
   * ADR-0015 §3: coalesces synchronous `forcePublish()` calls that arrive
   * before the microtask-deferred publish body starts running. Multiple
   * mutation handlers can `await monitor.forcePublish()` in the same event
   * loop tick (e.g. a burst of `finally`-block publishes from concurrent
   * messages) and all share one buildSnapshot + one broadcast. Calls that
   * arrive *after* the deferred body has started are NOT coalesced — they
   * proceed independently, preserving the pre-ADR-0015 "latest force wins"
   * semantics required by the monitor's staleness test.
   */
  private coalescingForce: Promise<void> | null = null;

  public constructor(
    private readonly tmux: TmuxGateway,
    private readonly pollIntervalMs: number,
    private readonly onUpdate: (state: TmuxStateSnapshot) => void,
    private readonly onError: (error: Error) => void
  ) {}

  /**
   * Latest broadcast snapshot. Consumers that need a pane's `currentPath`
   * (file panel HTTP routes) read this instead of re-querying tmux. Refreshed
   * every `pollIntervalMs` or on `forcePublish()`; undefined only before
   * `start()` resolves — since HTTP listening starts after `start()` awaits,
   * in practice this is always defined inside request handlers.
   */
  public get latestSnapshot(): TmuxStateSnapshot | undefined {
    return this.cachedSnapshot;
  }

  public async start(): Promise<void> {
    this.running = true;
    await this.publishSnapshot(false);
    this.scheduleNextTick();
  }

  public stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  public forcePublish(): Promise<void> {
    if (this.coalescingForce) {
      return this.coalescingForce;
    }
    const task = this.runForcePublish();
    this.coalescingForce = task;
    return task;
  }

  private async runForcePublish(): Promise<void> {
    // Yield so any additional synchronous forcePublish() calls made in the
    // same event-loop tick get a chance to hit the coalescingForce branch
    // and reuse this promise. Once we resume, clear the coalescer so a
    // later (post-await) caller spawns its own task.
    await Promise.resolve();
    this.coalescingForce = null;

    clearTimeout(this.timer);
    this.timer = undefined;
    const generation = ++this.forceGeneration;
    try {
      await this.publishSnapshot(true);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      // Only the latest concurrent force should schedule the next tick.
      if (generation === this.forceGeneration) {
        this.scheduleNextTick();
      }
    }
  }

  private scheduleNextTick(): void {
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      this.tick().finally(() => {
        this.scheduleNextTick();
      });
    }, this.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    try {
      await this.publishSnapshot(false);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async publishSnapshot(force: boolean): Promise<void> {
    const gen = this.forceGeneration;
    const snapshot = await buildSnapshot(this.tmux);

    // A newer forcePublish happened while we were building; discard stale data.
    if (gen !== this.forceGeneration) {
      return;
    }

    this.cachedSnapshot = snapshot;
    const serialized = JSON.stringify(snapshot.sessions);
    if (force || serialized !== this.lastSerializedState) {
      this.lastSerializedState = serialized;
      this.onUpdate(snapshot);
    }
  }
}
