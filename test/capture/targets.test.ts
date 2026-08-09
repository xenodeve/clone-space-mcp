import { describe, expect, test } from "bun:test";
import {
  markClosed,
  normalizeType,
  TARGETS_SCHEMA_VERSION,
  targetEntryFromCreated,
  validateTargets,
  type TargetEntry,
} from "../../src/capture/targets.ts";

describe("targetEntryFromCreated", () => {
  test("maps a page target payload", () => {
    const entry = targetEntryFromCreated(
      { targetId: "t1", type: "page", url: "https://example.com" },
      100,
    );
    expect(entry).toEqual({
      targetId: "t1",
      type: "page",
      url: "https://example.com",
      openedAt: 100,
    });
  });

  test("carries openerId when present", () => {
    const entry = targetEntryFromCreated(
      { targetId: "t2", type: "page", url: "https://example.com/popup", openerId: "t1" },
      200,
    );
    expect(entry.openerId).toBe("t1");
  });

  test("throws on a missing or non-string targetId", () => {
    expect(() => targetEntryFromCreated({ type: "page" }, 100)).toThrow(/targetId/);
    expect(() => targetEntryFromCreated({ targetId: 42, type: "page" }, 100)).toThrow(/targetId/);
  });

  test("throws on a non-finite openedAt", () => {
    expect(() => targetEntryFromCreated({ targetId: "t1", type: "page" }, NaN)).toThrow(/openedAt/);
  });
});

describe("normalizeType", () => {
  test("maps the canonical CDP set", () => {
    expect(normalizeType("page")).toBe("page");
    expect(normalizeType("iframe")).toBe("iframe");
    expect(normalizeType("worker")).toBe("worker");
    expect(normalizeType("service_worker")).toBe("service_worker");
    expect(normalizeType("shared_worker")).toBe("shared_worker");
    expect(normalizeType("worklet")).toBe("worklet");
  });

  test("falls unknown types to other", () => {
    expect(normalizeType("browser")).toBe("other");
    expect(normalizeType(undefined)).toBe("other");
    expect(normalizeType("")).toBe("other");
  });
});

describe("markClosed", () => {
  test("sets closedAt on the matching target", () => {
    const entries: TargetEntry[] = [
      { targetId: "t1", type: "page", openedAt: 100 },
      { targetId: "t2", type: "worker", openedAt: 200 },
    ];
    const updated = markClosed(entries, "t1", 300);
    expect(updated.find((e) => e.targetId === "t1")?.closedAt).toBe(300);
    expect(updated.find((e) => e.targetId === "t2")?.closedAt).toBeUndefined();
  });

  test("throws on an unknown target", () => {
    expect(() => markClosed([], "missing", 300)).toThrow(/unknown target/);
  });

  test("throws when closedAt is before openedAt", () => {
    const entries: TargetEntry[] = [{ targetId: "t1", type: "page", openedAt: 500 }];
    expect(() => markClosed(entries, "t1", 400)).toThrow(/closedAt/);
  });

  test("does not mutate the input array", () => {
    const entries: TargetEntry[] = [{ targetId: "t1", type: "page", openedAt: 100 }];
    markClosed(entries, "t1", 200);
    expect(entries[0]!.closedAt).toBeUndefined();
  });
});

describe("validateTargets", () => {
  const validDoc = {
    schemaVersion: 1,
    targets: [
      { targetId: "t1", type: "page", openedAt: 100, closedAt: 200 },
      { targetId: "t2", type: "worker", openedAt: 150 },
    ],
  };

  test("accepts a well-formed inventory", () => {
    expect(validateTargets(validDoc)).toEqual({ ok: true });
  });

  test("rejects an unsupported schema version", () => {
    expect(validateTargets({ ...validDoc, schemaVersion: 2 })).toEqual({ ok: false });
  });

  test("rejects a non-array targets value", () => {
    expect(validateTargets({ ...validDoc, targets: "x" })).toEqual({ ok: false });
  });

  test("rejects a non-string targetId", () => {
    expect(
      validateTargets({ ...validDoc, targets: [{ targetId: 42, type: "page", openedAt: 1 }] }),
    ).toEqual({ ok: false });
  });

  test("rejects an unknown type", () => {
    expect(
      validateTargets({ ...validDoc, targets: [{ targetId: "t1", type: "alien", openedAt: 1 }] }),
    ).toEqual({ ok: false });
  });

  test("rejects a non-finite openedAt", () => {
    expect(
      validateTargets({ ...validDoc, targets: [{ targetId: "t1", type: "page", openedAt: NaN }] }),
    ).toEqual({ ok: false });
  });

  test("rejects closedAt before openedAt", () => {
    expect(
      validateTargets({
        ...validDoc,
        targets: [{ targetId: "t1", type: "page", openedAt: 500, closedAt: 400 }],
      }),
    ).toEqual({ ok: false });
  });

  test("rejects a duplicate targetId", () => {
    expect(
      validateTargets({
        ...validDoc,
        targets: [
          { targetId: "t1", type: "page", openedAt: 100 },
          { targetId: "t1", type: "worker", openedAt: 200 },
        ],
      }),
    ).toEqual({ ok: false });
  });

  test("rejects a dangling openerId", () => {
    expect(
      validateTargets({
        ...validDoc,
        targets: [{ targetId: "t1", type: "page", openedAt: 100, openerId: "missing" }],
      }),
    ).toEqual({ ok: false });
  });

  test("rejects an openerId that names a LATER target", () => {
    expect(
      validateTargets({
        ...validDoc,
        targets: [
          { targetId: "t1", type: "page", openedAt: 100, openerId: "t2" },
          { targetId: "t2", type: "page", openedAt: 200 },
        ],
      }),
    ).toEqual({ ok: false });
  });

  test("accepts an openerId naming an earlier target", () => {
    expect(
      validateTargets({
        ...validDoc,
        targets: [
          { targetId: "t1", type: "page", openedAt: 100 },
          { targetId: "t2", type: "page", openedAt: 200, openerId: "t1" },
        ],
      }),
    ).toEqual({ ok: true });
  });

  test("exports the schema version", () => {
    expect(TARGETS_SCHEMA_VERSION).toBe(1);
  });
});
