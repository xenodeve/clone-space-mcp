// Bun entry point for the mutation hooks: `bun ... --preload ./scripts/mutation-preload.ts`.
//
// The corpus defect is applied to the module source **in memory**. The tracked file is never
// written, so "the working tree is unchanged after a mutation run" is true by construction rather
// than defended by a restore that a hard kill can skip (#82, after #78 measured that skip).
import { plugin } from "bun";
import { basename } from "node:path";
import { activeMutation, mutateModuleSource } from "./mutation-hook.ts";

const mutation = activeMutation();

if (mutation !== undefined) {
  // Filtered to the one file rather than every `.ts`: an `onLoad` over the whole module graph
  // would put this plugin in front of every import in the process for no reason.
  const target = new RegExp(`${basename(mutation.file).replaceAll(".", "\\.")}$`);

  plugin({
    name: "clone-space-corpus-defect",
    setup(build) {
      build.onLoad({ filter: target }, async (args) => {
        const source = await Bun.file(args.path).text();
        const mutated = mutateModuleSource(args.path, source);
        // Same basename, different file — hand back the original rather than skipping the load.
        return { contents: mutated ?? source, loader: "ts" };
      });
    },
  });
}
