// Bun entry point for the mutation hooks: `bun ... --preload ./scripts/mutation-preload.ts`.
//
// The corpus defect is applied to the module source **in memory**. The tracked file is never
// written, so "the working tree is unchanged after a mutation run" is true by construction rather
// than defended by a restore that a hard kill can skip (#82, after #78 measured that skip).
import { plugin } from "bun";
import { extname } from "node:path";
import { activeMutation, mutateModuleSource } from "./mutation-hook.ts";

const mutation = activeMutation();

if (mutation !== undefined) {
  if (extname(mutation.file) !== ".ts") {
    throw new Error(`this hook only knows how to load .ts, and ${mutation.file} is not`);
  }

  // Built from the whole repo-relative path, not the basename: the basename form also matched
  // `my-record.ts`, so unrelated modules were pulled through this plugin for no reason. Both
  // separators, because the path Bun hands `onLoad` is native.
  const target = new RegExp(`[/\\\\]${mutation.file.replaceAll("/", "[/\\\\\\\\]").replaceAll(".", "\\.")}$`);

  plugin({
    name: "clone-space-corpus-defect",
    setup(build) {
      build.onLoad({ filter: target }, async (args) => {
        const source = await Bun.file(args.path).text();
        // Returning `undefined` to pass through is not an option — measured: Bun reports
        // "Unhandled error between tests". So the original is handed back explicitly.
        return { contents: mutateModuleSource(args.path, source) ?? source, loader: "ts" };
      });
    },
  });
}
