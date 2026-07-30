import { describe, expect, test } from "bun:test";
import {
  reconcile,
  type ElementFingerprint,
  type IdentitySnapshot,
} from "../../src/identity/reconcile.ts";

/**
 * Capture and replay are two separate constructions of the same page: replay re-executes
 * the original JavaScript, so nodes are built again in an order that is only *mostly* the
 * same. `wa:` ids are therefore not comparable across runs by string equality — the
 * reconciler has to decide which replay element is which capture element from structure.
 *
 * The property that matters most is not the match rate. It is that an ambiguous element
 * comes back as `identity-unresolved` rather than as a confident wrong answer, because a
 * wrong answer here becomes mis-attributed animation data three phases later, with nothing
 * to signal it.
 */

function el(over: Partial<ElementFingerprint> & { id: string }): ElementFingerprint {
  return {
    frameKey: "0",
    tag: "div",
    attrs: {},
    siblingOrdinal: 0,
    textHash: null,
    parentId: null,
    ...over,
  };
}

function snapshot(elements: ElementFingerprint[]): IdentitySnapshot {
  return { schemaVersion: 1, elements };
}

describe("the ordinary case", () => {
  test("identical snapshots reconcile completely", () => {
    const els = [
      el({ id: "wa:0:1", tag: "header" }),
      el({ id: "wa:0:2", tag: "h1", parentId: "wa:0:1", textHash: "abc" }),
    ];
    const result = reconcile(snapshot(els), snapshot(els));

    expect(result.unresolved).toEqual([]);
    expect(result.matched).toHaveLength(2);
    expect(result.matched.map((m) => [m.captureId, m.replayId])).toEqual([
      ["wa:0:1", "wa:0:1"],
      ["wa:0:2", "wa:0:2"],
    ]);
  });

  test("a replay that assigned different sequence numbers still reconciles", () => {
    // This is the whole reason the reconciler exists: replay built the DOM again and the
    // counter landed elsewhere. Matching on id would report a total failure here.
    const capture = snapshot([
      el({ id: "wa:0:1", tag: "header" }),
      el({ id: "wa:0:2", tag: "h1", parentId: "wa:0:1", textHash: "abc" }),
    ]);
    const replay = snapshot([
      el({ id: "wa:0:41", tag: "header" }),
      el({ id: "wa:0:42", tag: "h1", parentId: "wa:0:41", textHash: "abc" }),
    ]);
    const result = reconcile(capture, replay);

    expect(result.unresolved).toEqual([]);
    expect(result.matched.map((m) => [m.captureId, m.replayId])).toEqual([
      ["wa:0:1", "wa:0:41"],
      ["wa:0:2", "wa:0:42"],
    ]);
  });
});

describe("duplicate siblings", () => {
  test("identical siblings are told apart by their ordinal, not guessed", () => {
    // The fixture's `duplicate-siblings` case: three <li> with no attribute, no text, and
    // nothing else to distinguish them.
    const make = (base: number) =>
      snapshot([
        el({ id: `wa:0:${base}`, tag: "ul" }),
        el({ id: `wa:0:${base + 1}`, tag: "li", parentId: `wa:0:${base}`, siblingOrdinal: 0 }),
        el({ id: `wa:0:${base + 2}`, tag: "li", parentId: `wa:0:${base}`, siblingOrdinal: 1 }),
        el({ id: `wa:0:${base + 3}`, tag: "li", parentId: `wa:0:${base}`, siblingOrdinal: 2 }),
      ]);

    const result = reconcile(make(1), make(90));

    expect(result.unresolved).toEqual([]);
    expect(result.matched.map((m) => [m.captureId, m.replayId])).toEqual([
      ["wa:0:1", "wa:0:90"],
      ["wa:0:2", "wa:0:91"],
      ["wa:0:3", "wa:0:92"],
      ["wa:0:4", "wa:0:93"],
    ]);
  });

  test("same shape under different parents is resolved by the parent, not by order", () => {
    const capture = snapshot([
      el({ id: "wa:0:1", tag: "div", attrs: { "data-host": "a" } }),
      el({ id: "wa:0:2", tag: "div", attrs: { "data-host": "b" } }),
      el({ id: "wa:0:3", tag: "span", parentId: "wa:0:1" }),
      el({ id: "wa:0:4", tag: "span", parentId: "wa:0:2" }),
    ]);
    // Replay emitted the two spans in the opposite order. Only the parent tells them apart.
    const replay = snapshot([
      el({ id: "wa:0:11", tag: "div", attrs: { "data-host": "a" } }),
      el({ id: "wa:0:12", tag: "div", attrs: { "data-host": "b" } }),
      el({ id: "wa:0:14", tag: "span", parentId: "wa:0:12" }),
      el({ id: "wa:0:13", tag: "span", parentId: "wa:0:11" }),
    ]);

    const result = reconcile(capture, replay);

    expect(result.unresolved).toEqual([]);
    const pairs = Object.fromEntries(result.matched.map((m) => [m.captureId, m.replayId]));
    expect(pairs["wa:0:3"]).toBe("wa:0:13");
    expect(pairs["wa:0:4"]).toBe("wa:0:14");
  });
});

describe("refusing to guess", () => {
  test("two indistinguishable replay candidates yield identity-unresolved, not a coin flip", () => {
    // The fixture's `delete-and-reinsert` case in its worst form: the element left the tree
    // and came back, so replay logged two elements that are identical in every recorded
    // respect. Any reconciler that always produces an answer produces a wrong one here.
    const capture = snapshot([
      el({ id: "wa:0:1", tag: "div", attrs: { "data-identity-case": "delete-and-reinsert" } }),
      el({ id: "wa:0:2", tag: "span", attrs: { class: "flicker" }, parentId: "wa:0:1" }),
    ]);
    const replay = snapshot([
      el({ id: "wa:0:1", tag: "div", attrs: { "data-identity-case": "delete-and-reinsert" } }),
      el({ id: "wa:0:2", tag: "span", attrs: { class: "flicker" }, parentId: "wa:0:1" }),
      el({ id: "wa:0:88", tag: "span", attrs: { class: "flicker" }, parentId: "wa:0:1" }),
    ]);

    const result = reconcile(capture, replay);

    expect(result.matched.map((m) => m.captureId)).toEqual(["wa:0:1"]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.captureId).toBe("wa:0:2");
    expect(result.unresolved[0]!.reason).toBe("ambiguous");
    // The candidates are reported so a human or a later pass can adjudicate. Dropping them
    // would turn a recoverable ambiguity into a dead end.
    expect(result.unresolved[0]!.candidates.sort()).toEqual(["wa:0:2", "wa:0:88"]);
  });

  test("an element that replay never produced is unresolved, not silently dropped", () => {
    const capture = snapshot([
      el({ id: "wa:0:1", tag: "div" }),
      el({ id: "wa:0:2", tag: "video", parentId: "wa:0:1" }),
    ]);
    const replay = snapshot([el({ id: "wa:0:1", tag: "div" })]);

    const result = reconcile(capture, replay);

    expect(result.matched.map((m) => m.captureId)).toEqual(["wa:0:1"]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]!.captureId).toBe("wa:0:2");
    expect(result.unresolved[0]!.reason).toBe("missing");
    expect(result.unresolved[0]!.candidates).toEqual([]);
  });

  test("a replay element with no capture counterpart is reported, not ignored", () => {
    // Replay producing something capture never saw is a fidelity signal in its own right —
    // silently discarding it would hide a real difference between the two runs.
    const capture = snapshot([el({ id: "wa:0:1", tag: "div" })]);
    const replay = snapshot([
      el({ id: "wa:0:1", tag: "div" }),
      el({ id: "wa:0:2", tag: "aside" }),
    ]);

    const result = reconcile(capture, replay);

    expect(result.replayOnly).toEqual(["wa:0:2"]);
  });
});

describe("the algorithm does not depend on emission order", () => {
  test("a snapshot listed children-first still resolves parents first", () => {
    // A preorder walk happens to list parents first, so relying on that would work today
    // and break silently the day a snapshot is merged, filtered, or re-serialised.
    const capture = snapshot([
      el({ id: "wa:0:3", tag: "span", parentId: "wa:0:1" }),
      el({ id: "wa:0:4", tag: "span", parentId: "wa:0:2" }),
      el({ id: "wa:0:1", tag: "div", attrs: { "data-host": "a" } }),
      el({ id: "wa:0:2", tag: "div", attrs: { "data-host": "b" } }),
    ]);
    const replay = snapshot([
      el({ id: "wa:0:13", tag: "span", parentId: "wa:0:11" }),
      el({ id: "wa:0:14", tag: "span", parentId: "wa:0:12" }),
      el({ id: "wa:0:11", tag: "div", attrs: { "data-host": "a" } }),
      el({ id: "wa:0:12", tag: "div", attrs: { "data-host": "b" } }),
    ]);

    const result = reconcile(capture, replay);

    expect(result.unresolved).toEqual([]);
    const pairs = Object.fromEntries(result.matched.map((m) => [m.captureId, m.replayId]));
    expect(pairs["wa:0:3"]).toBe("wa:0:13");
    expect(pairs["wa:0:4"]).toBe("wa:0:14");
  });

  test("matched is emitted in capture order regardless of processing order", () => {
    const capture = snapshot([
      el({ id: "wa:0:9", tag: "span", parentId: "wa:0:1" }),
      el({ id: "wa:0:1", tag: "div" }),
    ]);
    const result = reconcile(capture, capture);

    expect(result.matched.map((m) => m.captureId)).toEqual(["wa:0:9", "wa:0:1"]);
  });
});

describe("uncertainty does not propagate as certainty", () => {
  test("an unresolved parent does not narrow its child's candidates", () => {
    // The parent is ambiguous, so nothing is known about which replay subtree the child
    // belongs to. Letting an unresolved parent filter the child's pool would turn one
    // uncertainty into a chain of confident wrong answers.
    const capture = snapshot([
      el({ id: "wa:0:1", tag: "div", attrs: { class: "host" } }),
      el({ id: "wa:0:2", tag: "b", parentId: "wa:0:1" }),
    ]);
    const replay = snapshot([
      el({ id: "wa:0:1", tag: "div", attrs: { class: "host" } }),
      el({ id: "wa:0:5", tag: "div", attrs: { class: "host" } }),
      el({ id: "wa:0:2", tag: "b", parentId: "wa:0:1" }),
      el({ id: "wa:0:6", tag: "b", parentId: "wa:0:5" }),
    ]);

    const result = reconcile(capture, replay);

    const reasons = Object.fromEntries(result.unresolved.map((u) => [u.captureId, u.reason]));
    expect(reasons["wa:0:1"]).toBe("ambiguous");
    // The child must be reported as ambiguous too, listing BOTH candidates — not silently
    // bound to whichever <b> happened to be emitted first.
    expect(reasons["wa:0:2"]).toBe("ambiguous");
    const child = result.unresolved.find((u) => u.captureId === "wa:0:2");
    expect(child!.candidates.sort()).toEqual(["wa:0:2", "wa:0:6"]);
    expect(result.matched).toEqual([]);
  });
});

describe("frames are separate namespaces", () => {
  test("an identical element in a different frame is never matched across the boundary", () => {
    const capture = snapshot([
      el({ id: "wa:0:1", frameKey: "0", tag: "div", attrs: { class: "dot" } }),
      el({ id: "wa:0/1:1", frameKey: "0/1", tag: "div", attrs: { class: "dot" } }),
    ]);
    const replay = snapshot([
      el({ id: "wa:0:7", frameKey: "0", tag: "div", attrs: { class: "dot" } }),
      el({ id: "wa:0/1:9", frameKey: "0/1", tag: "div", attrs: { class: "dot" } }),
    ]);

    const result = reconcile(capture, replay);

    expect(result.unresolved).toEqual([]);
    const pairs = Object.fromEntries(result.matched.map((m) => [m.captureId, m.replayId]));
    expect(pairs["wa:0:1"]).toBe("wa:0:7");
    expect(pairs["wa:0/1:1"]).toBe("wa:0/1:9");
  });
});

describe("the schema is versioned", () => {
  test("reconciling snapshots of different schema versions is refused rather than attempted", () => {
    const capture = { schemaVersion: 1, elements: [el({ id: "wa:0:1" })] } as IdentitySnapshot;
    const replay = { schemaVersion: 2, elements: [el({ id: "wa:0:1" })] } as unknown as IdentitySnapshot;

    expect(() => reconcile(capture, replay)).toThrow(/schema version/i);
  });
});
