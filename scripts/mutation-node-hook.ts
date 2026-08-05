// Node entry point for the mutation hooks: `node --import ./scripts/mutation-node-hook.ts ...`.
//
// The counterpart of `mutation-preload.ts` for the corpus entries whose suite is the browser one,
// which runs under `node --test`. Both go through `mutateModuleSource`, so the two runtimes apply
// byte-identical text through the identical loud-on-mismatch rule.
//
// `--import` reaches the children `node --test` spawns per file. That is pinned by a test rather
// than asserted here — see "node --test --import reaches every per-file child it spawns" in
// `test/scripts/mutation-hook-runtime.test.ts`, which runs two fixture files and requires both to
// see the mutated module. A hook that never registers in the child is otherwise silent: the suite
// passes and the mutation reads as a defect that made no difference.
import { registerHooks } from "node:module";
import { mutateModuleSource } from "./mutation-hook.ts";

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (result.source === undefined || result.source === null) return result;

    const mutated = mutateModuleSource(url, result.source.toString());
    return mutated === undefined ? result : { ...result, source: mutated };
  },
});
