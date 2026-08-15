import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LIMITS,
  discoveredCandidates,
  INTERACTION_SCHEMA_VERSION,
  isStale,
  planActions,
  refuse,
  type Candidate,
  type ObservedElement,
} from "../../src/capture/interaction.ts";

/** A candidate that trips no rule: a plain, listener-bearing div outside any form. */
function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    selector: "div:nth-child(1)",
    tag: "div",
    role: "",
    label: "read more",
    type: "",
    href: "",
    target: "",
    download: false,
    inForm: false,
    sameOrigin: true,
    listeners: ["click"],
    scrollable: false,
    focusable: false,
    pointerCursor: false,
    order: 1,
    ...overrides,
  };
}

describe("refuse", () => {
  test("allows a plain listener-bearing element", () => {
    expect(refuse(candidate())).toBeUndefined();
  });

  test("refuses a submit control by its own rule", () => {
    expect(refuse(candidate({ tag: "button", type: "submit" }))?.rule).toBe("form-submission");
  });

  test("refuses a bare button inside a form, which submits by default", () => {
    expect(refuse(candidate({ tag: "button", inForm: true }))?.rule).toBe("form-submission");
  });

  test("allows an explicitly non-submitting button inside a form", () => {
    expect(refuse(candidate({ tag: "button", type: "button", inForm: true }))).toBeUndefined();
  });

  test("refuses an anchor that leaves the document", () => {
    expect(refuse(candidate({ tag: "a", href: "/pricing" }))?.rule).toBe("navigation");
  });

  test("allows a same-document fragment anchor", () => {
    expect(refuse(candidate({ tag: "a", href: "#features" }))).toBeUndefined();
  });

  test("allows a javascript: anchor, which activates script rather than navigating", () => {
    expect(refuse(candidate({ tag: "a", href: "javascript:void 0" }))).toBeUndefined();
  });

  test("refuses a download by its own rule, not as a navigation", () => {
    expect(refuse(candidate({ tag: "a", href: "#x", download: true }))?.rule).toBe("download");
  });

  test("refuses an element that opens another browsing context", () => {
    expect(refuse(candidate({ tag: "a", href: "#x", target: "_blank" }))?.rule).toBe(
      "new-browsing-context",
    );
  });

  test("allows an explicit _self target", () => {
    expect(refuse(candidate({ tag: "a", href: "#x", target: "_self" }))).toBeUndefined();
  });

  test("refuses anything pointing off-origin, ahead of the navigation rule", () => {
    expect(refuse(candidate({ tag: "a", href: "https://other.example/", sameOrigin: false }))?.rule).toBe(
      "cross-origin",
    );
  });

  test("refuses a file picker, which opens a dialog the driver cannot dismiss", () => {
    expect(refuse(candidate({ tag: "input", type: "file" }))?.rule).toBe("file-picker");
  });

  test("refuses an authentication control by its label", () => {
    expect(refuse(candidate({ label: "Connect Wallet" }))?.rule).toBe("authentication");
  });

  test("refuses a destructive control by its label", () => {
    expect(refuse(candidate({ label: "Delete account" }))?.rule).toBe("destructive-wording");
  });

  test("refuses a destructive control written in Thai", () => {
    expect(refuse(candidate({ label: "ยืนยันการชำระเงิน" }))?.rule).toBe("destructive-wording");
  });

  test("matches wording on a word boundary, not a substring", () => {
    // "buyer" contains "buy"; a substring match would refuse every persona page on the web.
    expect(refuse(candidate({ label: "For buyers" }))).toBeUndefined();
  });

  test("names the matched wording in the detail, so the record is checkable", () => {
    expect(refuse(candidate({ label: "Delete account" }))?.detail).toContain("delete");
  });

  test("is pure — it does not mutate the candidate it judges", () => {
    const input = candidate({ tag: "a", href: "/pricing", listeners: ["click"] });
    const before = JSON.stringify(input);
    refuse(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("planActions", () => {
  test("plans a click for an allowed candidate", () => {
    const plan = planActions([candidate()], DEFAULT_LIMITS);
    expect(plan.actions).toEqual([
      { kind: "click", selector: "div:nth-child(1)", order: 1, tag: "div", label: "read more" },
    ]);
  });

  test("carries the facts the policy judged, so the driver can check them again", () => {
    const plan = planActions([candidate({ tag: "button", label: "Show details" })], DEFAULT_LIMITS);
    expect(plan.actions[0]).toMatchObject({ tag: "button", label: "Show details" });
  });

  test("stamps the schema version", () => {
    expect(planActions([], DEFAULT_LIMITS).schemaVersion).toBe(INTERACTION_SCHEMA_VERSION);
  });

  test("withholds the click from a refused candidate and records the refusal", () => {
    const plan = planActions([candidate({ tag: "a", href: "/pricing" })], DEFAULT_LIMITS);
    expect(plan.actions.some((action) => action.kind === "click")).toBe(false);
    expect(plan.refusals).toEqual([
      { selector: "div:nth-child(1)", rule: "navigation", detail: "href leaves the document: /pricing" },
    ]);
  });

  test("still hovers a refused candidate, because hovering cannot navigate or submit", () => {
    const plan = planActions(
      [candidate({ tag: "a", href: "/pricing", listeners: ["click", "mouseenter"] })],
      DEFAULT_LIMITS,
    );
    expect(plan.actions.map((action) => action.kind)).toEqual(["hover"]);
  });

  test("counts every candidate it was given, refused or not", () => {
    const plan = planActions(
      [candidate(), candidate({ selector: "a", tag: "a", href: "/x", order: 2 })],
      DEFAULT_LIMITS,
    );
    expect(plan.discovered).toBe(2);
  });

  test("orders actions least-destructive first, so a click cannot invalidate an earlier target", () => {
    const plan = planActions(
      [
        candidate({ selector: "#c", order: 3 }),
        candidate({ selector: "#s", order: 1, listeners: [], scrollable: true }),
        candidate({ selector: "#f", order: 2, listeners: [], focusable: true }),
        candidate({ selector: "#h", order: 4, listeners: ["mouseenter"] }),
      ],
      DEFAULT_LIMITS,
    );
    expect(plan.actions.map((action) => action.kind)).toEqual(["scroll", "hover", "focus", "click"]);
  });

  test("is deterministic — the same candidates in a different array order give the same plan", () => {
    const a = candidate({ selector: "#a", order: 1 });
    const b = candidate({ selector: "#b", order: 2 });
    expect(planActions([a, b], DEFAULT_LIMITS)).toEqual(planActions([b, a], DEFAULT_LIMITS));
  });

  test("bounds each kind and counts what the bound dropped", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      candidate({ selector: `#n${index}`, order: index }),
    );
    const plan = planActions(many, { perKind: 2, total: 10 });
    expect(plan.actions).toHaveLength(2);
    expect(plan.truncated.click).toBe(3);
  });

  test("bounds the total as well, and the drop is still counted", () => {
    const many = Array.from({ length: 4 }, (_, index) =>
      candidate({ selector: `#n${index}`, order: index, listeners: ["click", "mouseenter"] }),
    );
    const plan = planActions(many, { perKind: 4, total: 5 });
    expect(plan.actions).toHaveLength(5);
    // Pinned per kind, not as a sum: hovers are planned first and all four fit, so every dropped
    // action is a click. A sum assertion accepts any split and would hide a mis-attribution.
    expect(plan.truncated).toEqual({ scroll: 0, hover: 0, focus: 0, click: 3 });
  });

  test("reports zero truncation when nothing was dropped, rather than omitting the kind", () => {
    const plan = planActions([candidate()], DEFAULT_LIMITS);
    expect(plan.truncated).toEqual({ scroll: 0, hover: 0, focus: 0, click: 0 });
  });

  test("plans nothing for an element that offers no interaction at all", () => {
    expect(planActions([candidate({ listeners: [] })], DEFAULT_LIMITS).actions).toEqual([]);
  });

  test("hovers on a pointer cursor alone, which is the only hover signal structure carries", () => {
    const plan = planActions([candidate({ listeners: [], pointerCursor: true })], DEFAULT_LIMITS);
    expect(plan.actions.map((action) => action.kind)).toEqual(["hover"]);
  });
});

describe("isStale", () => {
  const action = {
    kind: "click" as const,
    selector: "#b",
    order: 1,
    tag: "button",
    label: "Show details",
  };
  const seen: ObservedElement = {
    found: true,
    tag: "button",
    role: "",
    label: "Show details",
    type: "button",
    href: "",
    target: "",
    download: false,
    inForm: false,
    sameOrigin: true,
  };

  test("passes an element that is still what the policy judged", () => {
    expect(isStale(action, seen)).toBe("");
  });

  test("stops an action whose element is gone, and names the selector", () => {
    expect(isStale(action, { ...seen, found: false })).toContain("#b");
  });

  test("stops an action whose element is now a different tag", () => {
    expect(isStale(action, { ...seen, tag: "a" })).toContain("tag changed");
  });

  test("stops a click on an element the policy would now refuse — the drift that does damage", () => {
    expect(isStale(action, { ...seen, label: "Delete account" })).toContain("destructive-wording");
  });

  test("stops a click on an element that became a submit control", () => {
    expect(isStale(action, { ...seen, type: "submit" })).toContain("form-submission");
  });

  test("lets a click through a text change the policy still allows — a live badge is not drift", () => {
    // `<button>Inbox (3)</button>` becoming `Inbox (4)` is an ordinary update. Comparing the label
    // as a string skipped this correct click; re-running the policy does not.
    const before = { ...action, label: "Inbox (3)" };
    expect(isStale(before, { ...seen, label: "Inbox (4)" })).toBe("");
  });

  test("lets a hover through, since hovering cannot submit or navigate", () => {
    expect(isStale({ ...action, kind: "hover" }, { ...seen, label: "Delete account" })).toBe("");
  });
});

describe("discoveredCandidates", () => {
  test("keeps a well-formed row", () => {
    expect(discoveredCandidates([candidate()])).toHaveLength(1);
  });

  test("drops a row missing a boolean rather than throwing, and says so by its count", () => {
    const broken = { ...candidate(), pointerCursor: undefined };
    expect(discoveredCandidates([candidate(), broken])).toHaveLength(1);
  });

  test("returns nothing for a page that answered with something other than an array", () => {
    expect(discoveredCandidates(undefined)).toEqual([]);
  });
});
