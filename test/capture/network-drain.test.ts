import { describe, expect, test } from "bun:test";
import { createNetworkDrain } from "../../src/capture/network-drain.ts";

/**
 * #156, second deliverable. The sweep's quiet window measures DOM activity and has no view of the
 * network, so the recording context can be torn down while responses are still arriving. Measured
 * through the tool entry points on `https://firecrawl.dev/`: 4 HAR entries with no response and
 * **no recorded failure** — four answers that were on their way when capture stopped waiting.
 */
describe("createNetworkDrain", () => {
  test("is idle immediately when nothing was ever in flight", async () => {
    const drain = createNetworkDrain();
    expect(drain.inFlight()).toBe(0);
    expect(await drain.idle(1000)).toBe(true);
  });

  test("waits for the last outstanding request and then reports idle", async () => {
    const drain = createNetworkDrain();
    drain.started();
    drain.started();
    expect(drain.inFlight()).toBe(2);

    setTimeout(() => drain.settled(), 5);
    setTimeout(() => drain.settled(), 10);

    expect(await drain.idle(1000)).toBe(true);
    expect(drain.inFlight()).toBe(0);
  });

  // The bound is the point. A tracker that never answers is normal on a real page, and waiting for
  // it is how capture stops terminating — §6.10's wall-clock promise has to survive this.
  test("gives up at the deadline and says so", async () => {
    const drain = createNetworkDrain();
    drain.started();
    const startedAt = Date.now();

    expect(await drain.idle(20)).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(drain.inFlight()).toBe(1);
  });

  test("a settle that outnumbers its starts cannot drive the count negative", async () => {
    const drain = createNetworkDrain();
    drain.settled();
    drain.settled();
    expect(drain.inFlight()).toBe(0);
    expect(await drain.idle(1000)).toBe(true);
  });

  // Two callers can wait on the same drain — the observation boundary and a test, say — and both
  // have to be released, not just whichever registered first.
  test("releases every waiter when the last request settles", async () => {
    const drain = createNetworkDrain();
    drain.started();
    setTimeout(() => drain.settled(), 5);
    expect(await Promise.all([drain.idle(1000), drain.idle(1000)])).toEqual([true, true]);
  });
});
