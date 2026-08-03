export interface Mutation {
  id: string;
  why: string;
  file: string;
  find: string;
  replace: string;
  suite: "bun" | "browser";
  expect: string;
}

// Browser-only defects are deliberately not in this corpus yet: the page.url() epoch leak and
// the epoch:0 counter need suite: "browser" wiring that this pass does not exercise.
export const MUTATIONS: Mutation[] = [
  {
    id: "publish-validation-unwired",
    why: "2d29a66 — deleting the call left 47 Bun + 22 browser green.",
    file: "src/capture/record.ts",
    find: "if (!staged.ok) {",
    replace: "if (false) {",
    suite: "bun",
    expect: "captureHar refuses to publish when a HAR attachment corrupts a staged sidecar",
  },
  {
    id: "epoch-shape-rule-gone",
    why: "Issue #47 — removing the document-epoch shape check let URL-shaped and short epochs pass.",
    file: "src/capture/checkpoints.ts",
    find: "^epoch:[0-9A-Za-z_-]{16,}$",
    replace: ".+",
    suite: "bun",
    expect: "rejects a documentEpoch that carries the captured page URL",
  },
  {
    id: "epoch-binding-unchecked",
    why: "89650be — deleting the documentEpoch binding refusal left 61 Bun tests green.",
    file: "src/capture/checkpoints.ts",
    find: "if (binding.documentEpoch !== finalCheckpoint.primaryTarget.documentEpoch) {",
    replace: "if (false) {",
    suite: "bun",
    expect: "refuses when the binding names the final checkpoint but a different document epoch",
  },
  {
    id: "openedat-binding-unchecked",
    why: "1b71ef2 — deleting the openedAt binding refusal left 61 Bun tests green.",
    file: "src/capture/checkpoints.ts",
    find: "if (binding.openedAt !== finalCheckpoint.openedAt) return { ok: false };",
    replace: "if (false) return { ok: false };",
    suite: "bun",
    expect: "refuses when the binding names the final checkpoint but a different openedAt",
  },
  {
    id: "mid-checkpoint-navigation-allowed",
    why: "Issue #47 — deleting the loaderId change refusal allowed mid-checkpoint navigation.",
    file: "src/capture/record.ts",
    find: "if (loaderIdAtClose !== loaderIdAtOpen) {",
    replace: "if (false) {",
    suite: "bun",
    expect: "captureHar refuses to publish when the primary document changes while the checkpoint was open",
  },
  {
    id: "har-existence-unchecked",
    why: "Issue #47 — removing the HAR isFile refusal allowed a directory association.",
    file: "src/capture/checkpoints.ts",
    find: "if (!(await lstat(harPath)).isFile()) return { ok: false };",
    replace: "if (false) return { ok: false };",
    suite: "bun",
    expect: "refuses when the HAR association names a directory",
  },
  {
    id: "har-containment-unchecked",
    why: "Issue #47 — removing the HAR containment refusal allowed an association outside staging.",
    file: "src/capture/checkpoints.ts",
    find: "if (!isStrictlyWithin(resolvedRoot, resolvedHarPath)) return { ok: false };",
    replace: "if (false) return { ok: false };",
    suite: "bun",
    expect: "refuses when the HAR association resolves outside the staging root",
  },
];
