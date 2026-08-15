/**
 * §6.10 + #156: a bounded wait for responses that are still arriving.
 *
 * The sweep's termination test runs inside `page.evaluate` and measures **DOM activity** — height,
 * node count, scroll events, a quiet window over checkpoints. It has no view of the network at
 * all, so the quiet window can close while responses are in flight, the recording context is torn
 * down, and Playwright writes the unfinished ones into the HAR with `response.status: -1`.
 *
 * Measured through the tool entry points on `https://firecrawl.dev/`: **4 entries with no response
 * and no recorded failure** — four answers that were on their way when capture stopped waiting.
 * (A *failed* request is different and is not this: the live browser did not get it either, so an
 * archive recording the failure is faithful. `termination.json` counts the two apart.)
 *
 * **The bound is not optional.** A tracker or a long-poll that never answers is ordinary on a real
 * page, and waiting for one is how capture stops terminating. §6.10's wall-clock figure is the
 * archive's promise about how long a capture takes, and a drain outside that bound is a hole in it.
 */

/** How long capture may wait for in-flight responses before publishing without them. */
export const NETWORK_DRAIN_DEADLINE_MS = 5_000;

export interface NetworkDrain {
  /** A request left the browser. */
  started(): void;
  /** A request finished or failed. Either way it is no longer outstanding. */
  settled(): void;
  /** How many requests are outstanding right now. */
  inFlight(): number;
  /**
   * Resolve `true` once nothing is outstanding, or `false` when `deadlineMs` wins. The deadline is
   * about time, not outcome: a request that fails has settled.
   */
  idle(deadlineMs: number): Promise<boolean>;
}

export function createNetworkDrain(): NetworkDrain {
  let outstanding = 0;
  let waiters: Array<() => void> = [];

  const release = (): void => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  return {
    started() {
      outstanding += 1;
    },
    settled() {
      // Clamped rather than allowed to go negative. Playwright can report a settle for a request
      // whose start this never saw — a redirect leg, or one begun before the listeners attached —
      // and a negative count would make a page with real outstanding work look idle.
      if (outstanding > 0) outstanding -= 1;
      if (outstanding === 0) release();
    },
    inFlight() {
      return outstanding;
    },
    async idle(deadlineMs) {
      if (outstanding === 0) return true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          new Promise<boolean>((resolve) => {
            waiters.push(() => resolve(true));
          }),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), deadlineMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
