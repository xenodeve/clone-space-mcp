import { describe, expect, test } from "bun:test";
import {
  TARGET_REF_SCHEMA_VERSION,
  validateTargetRef,
  type TargetRefV1,
} from "../../src/capture/target-ref.ts";

describe("TargetRefV1 union", () => {
  const WA = "wa:div|0:12"; // real shape: wa:<frame-key>:<sequence>
  const valid: Array<{ name: string; ref: TargetRefV1 }> = [
    { name: "element", ref: { kind: "element", wa: WA } },
    { name: "pseudo-element", ref: { kind: "pseudo-element", wa: WA, pseudo: "::before" } },
    { name: "document", ref: { kind: "document" } },
    { name: "window", ref: { kind: "window" } },
    { name: "js-object", ref: { kind: "js-object", id: "obj-1" } },
    { name: "graphics-resource", ref: { kind: "graphics-resource", url: "https://example.com/img.png" } },
    { name: "opaque", ref: { kind: "opaque" } },
    { name: "opaque with note", ref: { kind: "opaque", note: "canvas semantics unsupported" } },
  ];

  test("accepts every member of the V1 union with correct required fields", () => {
    for (const { name, ref } of valid) {
      expect(validateTargetRef(ref), name).toEqual({ ok: true });
    }
  });

  test("accepts the union written as JSON with the same shape", () => {
    for (const { name, ref } of valid) {
      const doc = JSON.parse(JSON.stringify(ref)) as unknown;
      expect(validateTargetRef(doc), name).toEqual({ ok: true });
    }
  });

  test("rejects an unknown kind", () => {
    expect(validateTargetRef({ kind: "widget", wa: "wa:1" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "elementx", wa: "wa:1" })).toEqual({ ok: false });
  });

  test("rejects a non-record value", () => {
    for (const doc of [null, undefined, 1, "ref", [], true]) {
      expect(validateTargetRef(doc)).toEqual({ ok: false });
    }
  });

  test("rejects element without a wa handle", () => {
    expect(validateTargetRef({ kind: "element" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "element", wa: "" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "element", wa: "not-a-wa-handle" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "element", wa: 42 })).toEqual({ ok: false });
  });

  test("rejects pseudo-element without wa or pseudo, or with a non-string pseudo", () => {
    expect(validateTargetRef({ kind: "pseudo-element", wa: "wa:1" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "pseudo-element", pseudo: "::before" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "pseudo-element", wa: "wa:1", pseudo: "" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "pseudo-element", wa: "wa:1", pseudo: 42 })).toEqual({ ok: false });
  });

  test("rejects js-object without an id", () => {
    expect(validateTargetRef({ kind: "js-object" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "js-object", id: "" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "js-object", id: 42 })).toEqual({ ok: false });
  });

  test("rejects graphics-resource with an invalid URL", () => {
    expect(validateTargetRef({ kind: "graphics-resource", url: "not a url" })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "graphics-resource" })).toEqual({ ok: false });
  });

  test("rejects extra unknown fields (a reader must not silently drop information)", () => {
    expect(validateTargetRef({ kind: "document", extra: 1 })).toEqual({ ok: false });
    expect(validateTargetRef({ kind: "opaque", unexpected: "x" })).toEqual({ ok: false });
  });

  test("rejects opaque with a non-string note", () => {
    expect(validateTargetRef({ kind: "opaque", note: 42 })).toEqual({ ok: false });
  });

  test("exports schema version 1", () => {
    expect(TARGET_REF_SCHEMA_VERSION).toBe(1);
  });
});
