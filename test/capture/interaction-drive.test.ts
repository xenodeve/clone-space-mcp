import { describe, expect, test } from "bun:test";
import { driveInteraction, type DrivablePage } from "../../src/capture/interaction-drive.ts";
import {
  INTERACTION_SCHEMA_VERSION,
  type InteractionPlan,
  type ObservedElement,
  type PlannedAction,
} from "../../src/capture/interaction.ts";

function plan(actions: PlannedAction[]): InteractionPlan {
  return {
    schemaVersion: INTERACTION_SCHEMA_VERSION,
    discovered: actions.length,
    actions,
    refusals: [],
    truncated: { scroll: 0, hover: 0, focus: 0, click: 0 },
  };
}

/**
 * A page that records what it was asked to do.
 *
 * `evaluate` serves two callers: the revalidation read, which must answer with an `ObservedElement`,
 * and the scroll, which returns nothing. They are told apart by what the driver does with the
 * result, so the fake answers the observation shape and records a scroll when the function is not
 * the observer.
 */
function fakePage(
  options: { navigateOn?: number; throwOn?: number; observe?: (selector: string) => ObservedElement } = {},
) {
  const calls: string[] = [];
  let url = "https://example.test/start";
  let performedCount = 0;
  const act = async (verb: string, selector: string) => {
    performedCount += 1;
    if (options.throwOn === performedCount) throw new Error(`locator timeout\nsecond line`);
    calls.push(`${verb} ${selector}`);
    if (options.navigateOn === performedCount) url = "https://example.test/elsewhere";
  };
  const page: DrivablePage = {
    url: () => url,
    hover: (selector) => act("hover", selector),
    focus: (selector) => act("focus", selector),
    click: (selector) => act("click", selector),
    evaluate: (async (fn: (selector: string) => unknown, arg: string) => {
      // The observer is the only evaluate whose result the driver reads.
      if (fn.name === "observeElement") return options.observe?.(arg) ?? PRESENT;
      await act("scroll", arg);
      return undefined;
    }) as DrivablePage["evaluate"],
    waitForTimeout: async () => {},
  };
  return { page, calls };
}

const FACTS = { tag: "div", label: "read more" };

/** The element still being what the plan judged: same tag, and nothing the policy would refuse. */
const PRESENT: ObservedElement = {
  found: true,
  ...FACTS,
  role: "",
  type: "",
  href: "",
  target: "",
  download: false,
  inForm: false,
  sameOrigin: true,
};
const HOVER: PlannedAction = { kind: "hover", selector: "#a", order: 1, ...FACTS };
const CLICK: PlannedAction = { kind: "click", selector: "#b", order: 2, ...FACTS };
const SCROLL: PlannedAction = { kind: "scroll", selector: "#c", order: 3, ...FACTS };

describe("driveInteraction", () => {
  test("performs each action with the verb its kind names", async () => {
    const { page, calls } = fakePage();
    await driveInteraction(page, plan([SCROLL, HOVER, CLICK]), { settleMs: 0 });
    expect(calls).toEqual(["scroll #c", "hover #a", "click #b"]);
  });

  test("reports every performed action as ok with no note", async () => {
    const { page } = fakePage();
    const report = await driveInteraction(page, plan([HOVER]), { settleMs: 0 });
    expect(report.performed).toEqual([{ kind: "hover", selector: "#a", ok: true, note: "" }]);
  });

  test("records a failed action and keeps going, because a miss is not a failed run", async () => {
    const { page } = fakePage({ throwOn: 1 });
    const report = await driveInteraction(page, plan([HOVER, CLICK]), { settleMs: 0 });
    expect(report.performed.map((result) => result.ok)).toEqual([false, true]);
    expect(report.performed[0]?.note).toBe("locator timeout");
  });

  test("stops the moment the document navigates, rather than driving a page it never discovered", async () => {
    const { page, calls } = fakePage({ navigateOn: 1 });
    const report = await driveInteraction(page, plan([HOVER, CLICK, SCROLL]), { settleMs: 0 });
    expect(calls).toEqual(["hover #a"]);
    expect(report.navigatedTo).toBe("https://example.test/elsewhere");
  });

  test("counts what it abandoned, so a short transcript cannot read as a complete one", async () => {
    const { page } = fakePage({ navigateOn: 1 });
    const report = await driveInteraction(page, plan([HOVER, CLICK, SCROLL]), { settleMs: 0 });
    expect(report.abandoned).toBe(2);
  });

  test("leaves navigatedTo empty and abandons nothing on a clean run", async () => {
    const { page } = fakePage();
    const report = await driveInteraction(page, plan([HOVER, CLICK]), { settleMs: 0 });
    expect(report.navigatedTo).toBe("");
    expect(report.abandoned).toBe(0);
  });

  test("never activates an element the policy would now refuse", async () => {
    const { page, calls } = fakePage({
      observe: (selector) =>
        selector === "#b" ? { ...PRESENT, label: "Delete account" } : PRESENT,
    });
    const report = await driveInteraction(page, plan([HOVER, CLICK]), { settleMs: 0 });
    expect(calls).not.toContain("click #b");
    expect(report.performed[1]).toMatchObject({
      ok: false,
      note: expect.stringContaining("destructive-wording"),
    });
  });

  test("skips a vanished element without spending an actionability timeout on it", async () => {
    const { page, calls } = fakePage({ observe: () => ({ ...PRESENT, found: false }) });
    const report = await driveInteraction(page, plan([HOVER]), { settleMs: 0 });
    expect(calls).toEqual([]);
    expect(report.performed[0]?.note).toContain("element is gone");
  });

  test("names the URL the plan was discovered against", async () => {
    const { page } = fakePage({ navigateOn: 1 });
    const report = await driveInteraction(page, plan([HOVER, CLICK]), { settleMs: 0 });
    expect(report.startedAt).toBe("https://example.test/start");
  });
});
