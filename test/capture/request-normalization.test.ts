import { expect, test } from "bun:test";
import {
  defaultRequestNormalization,
  validateRequestNormalization,
} from "../../src/capture/request-normalization.ts";

test("defaultRequestNormalization returns the V1 empty policy", () => {
  expect(defaultRequestNormalization()).toEqual({
    schemaVersion: 1,
    query: {
      volatileKeys: [],
      keyMatch: "case-insensitive-exact",
    },
  });
});

test("accepts the default V1 empty policy", () => {
  expect(validateRequestNormalization(defaultRequestNormalization())).toEqual({ ok: true });
});

test("rejects a non-record document", () => {
  for (const doc of [null, undefined, 1, "policy", [], true]) {
    expect(validateRequestNormalization(doc)).toEqual({ ok: false });
  }
});

test("rejects an unsupported schema version", () => {
  expect(
    validateRequestNormalization({ ...defaultRequestNormalization(), schemaVersion: 2 }),
  ).toEqual({ ok: false });
});

test("rejects a missing or malformed query object", () => {
  for (const query of [undefined, null, "x", [], { volatileKeys: [] }]) {
    expect(validateRequestNormalization({ schemaVersion: 1, query })).toEqual({ ok: false });
  }
});

test("rejects a non-array volatileKeys", () => {
  expect(
    validateRequestNormalization({
      schemaVersion: 1,
      query: { volatileKeys: "token", keyMatch: "case-insensitive-exact" },
    }),
  ).toEqual({ ok: false });
});

test("accepts a non-empty volatileKeys list in canonical form (explicit policy from #91)", () => {
  const doc = {
    ...defaultRequestNormalization(),
    query: { volatileKeys: ["_t", "nonce"], keyMatch: "case-insensitive-exact" as const },
  };
  expect(validateRequestNormalization(doc)).toEqual({ ok: true });
});

test("rejects a volatileKeys list containing an empty or non-string key", () => {
  expect(
    validateRequestNormalization({
      schemaVersion: 1,
      query: { volatileKeys: [""], keyMatch: "case-insensitive-exact" },
    }),
  ).toEqual({ ok: false });
  expect(
    validateRequestNormalization({
      schemaVersion: 1,
      query: { volatileKeys: [42], keyMatch: "case-insensitive-exact" },
    }),
  ).toEqual({ ok: false });
});

test("rejects an unsupported keyMatch", () => {
  const doc = {
    ...defaultRequestNormalization(),
    query: { volatileKeys: [], keyMatch: "fuzzy" },
  };
  expect(validateRequestNormalization(doc)).toEqual({ ok: false });
});
