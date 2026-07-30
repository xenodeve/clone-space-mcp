import { expect, test } from "bun:test";
import { STAGES } from "../src/index.ts";

test("the pipeline is capture -> replay -> extract -> serve, in order", () => {
  expect(STAGES).toEqual(["capture", "replay", "extract", "serve"]);
});
