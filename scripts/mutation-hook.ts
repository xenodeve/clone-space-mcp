import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMutationText } from "./mutation-apply.ts";
import { MUTATIONS, type Mutation } from "./mutations.ts";
import { repoRoot } from "./repo-root.ts";

/**
 * The environment variable both runtimes read. It travels out-of-band rather than on argv because
 * `bun test` and `node --test` each own their own argv, and a flag smuggled onto either is a flag
 * one of them may one day claim.
 */
export const MUTATION_ENV = "CLONE_SPACE_MUTATION";

/**
 * Printed by the hook when the corpus no longer matches the code. The runner greps for it, because
 * since #82 a rotted anchor fails inside the child and would otherwise be indistinguishable from
 * the suite failing for the reason the mutation intended.
 */
export const NOT_APPLIED_TOKEN = "CLONE_SPACE_MUTATION_NOT_APPLIED";

/**
 * Printed by the hook when it **did** rewrite the module.
 *
 * Writing the defect to disk used to fail before the suite started, whatever the suite imported.
 * A load hook only fires if something loads the file — so without this, a corpus entry whose
 * target no module imports would come back `SURVIVED`, which is a perfectly reasonable-looking
 * result produced by a defect that was never applied. The runner requires the positive signal.
 */
export const APPLIED_TOKEN = "CLONE_SPACE_MUTATION_APPLIED";

/** The flags each runtime needs to register the hook. Shared so a caller cannot use a stale pair. */
export const BUN_MUTATION_FLAGS = ["--preload", "./scripts/mutation-preload.ts"] as const;
export const NODE_MUTATION_FLAGS = ["--import", "./scripts/mutation-node-hook.ts"] as const;

function normalize(pathOrUrl: string): string {
  const path = pathOrUrl.startsWith("file:") ? fileURLToPath(pathOrUrl) : pathOrUrl;
  return resolve(path).replaceAll("\\", "/");
}

/**
 * Is the module being loaded the one this corpus entry rewrites?
 *
 * Compared as a resolved absolute path, not a suffix: a same-named file under a different root
 * must not match, and getting that wrong is silent — the hook fires on the wrong file, or never
 * fires, and either way the run measures something other than what it reports.
 */
export function targetsModule(mutation: Mutation, modulePathOrUrl: string, root: string): boolean {
  return normalize(modulePathOrUrl) === normalize(resolve(root, mutation.file));
}

/** The corpus entry this process was started to apply, if any. */
export function activeMutation(): Mutation | undefined {
  const id = process.env[MUTATION_ENV];
  if (id === undefined || id === "") return undefined;

  const mutation = MUTATIONS.find((candidate) => candidate.id === id);
  if (!mutation) {
    throw new Error(`unknown mutation id "${id}" — the ids live in scripts/mutations.ts`);
  }
  return mutation;
}

/**
 * Rewrite `source` if this module is the one the active mutation names.
 *
 * Shared by the Bun and Node entry points so both runtimes apply the identical text, through the
 * identical loud-on-mismatch rule in `applyMutationText`. Returns `undefined` when this module is
 * not the target, which both hooks read as "leave it alone".
 */
export function mutateModuleSource(modulePathOrUrl: string, source: string): string | undefined {
  const selected = activeMutation();
  if (selected === undefined) return undefined;
  if (!targetsModule(selected, modulePathOrUrl, repoRoot)) return undefined;

  // Throws on a rotted anchor rather than returning the source unchanged. A hook that quietly
  // declines to mutate is indistinguishable, downstream, from a defect that made no difference.
  try {
    const mutated = applyMutationText(source, selected.find, selected.replace, selected.file);
    // The runner reads this out of the child's output and treats its absence as "not applied".
    console.log(APPLIED_TOKEN);
    return mutated;
  } catch (error) {
    // Tagged, because the runner reads this out of a child's merged output where every other line
    // is the suite's own. An untagged message is one the runner has to guess at.
    throw new Error(`${NOT_APPLIED_TOKEN}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
