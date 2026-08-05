import { readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Thrown when the file could not be put into the mutated state — a rotted anchor, or a write that
 * did not land. Callers distinguish it from a failure raised by the work itself, because the two
 * mean opposite things: this one says the corpus or the environment is wrong, not the code.
 */
export class MutationNotAppliedError extends Error {}

/** Non-overlapping occurrences, the same notion `applyMutationText` enforces. */
export function countOccurrences(content: string, find: string): number {
  return content.split(find).length - 1;
}

/**
 * Apply one text mutation, or fail loudly.
 *
 * A mutation that does not apply must never look like a mutation that made no difference. The
 * anchor is required to match exactly once: zero means it has rotted (a fix moved the text, or the
 * pattern was written with the wrong line endings), and more than once means the anchor does not
 * identify a single site.
 */
export function applyMutationText(content: string, find: string, replace: string, file: string): string {
  const occurrences = countOccurrences(content, find);
  if (occurrences !== 1) {
    throw new MutationNotAppliedError(`find text occurs ${occurrences} times in ${file}, expected 1`);
  }

  const mutated = content.replace(find, replace);
  if (mutated === content) {
    throw new MutationNotAppliedError(`the replacement changes nothing in ${file}`);
  }
  return mutated;
}

/**
 * Put the original back, but only if the file is still the one we mutated.
 *
 * Writing unconditionally is how a second runner puts the *first* runner's mutation back on disk —
 * observed on #78. `landed === false` is the one case where an unconditional write is right: the
 * file is our own half-written mess, and nobody else can own it yet.
 *
 * Idempotent, because the signal path and the `finally` path can both reach it in one run.
 */
function restoreIfOurs(path: string, original: string, mutated: string, landed: boolean): void {
  let current: string | undefined;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = undefined;
  }

  // `current === undefined` means the file is gone. Writing the original back is unambiguously
  // better than leaving a deleted source file behind, so it is not treated as a foreign change.
  if (landed && current !== mutated && current !== undefined) {
    if (current === original) return;
    // Loud AND non-zero. Printing alone would leave the run exiting 0 with a published result and
    // a file nobody put back — the shape of failure this whole mechanism exists to refuse.
    process.exitCode = 1;
    console.error(`RESTORE SKIPPED: ${path} changed while it was mutated — left as found`);
    return;
  }

  // Never throws: this runs inside a `finally`, where an exception would replace the body's error
  // with a filesystem one and lose the finding the run existed to produce.
  try {
    writeFileSync(path, original, "utf8");
    if (readFileSync(path, "utf8") !== original) throw new Error("read-back mismatch");
  } catch (error) {
    process.exitCode = 1;
    console.error(`RESTORE FAILED: ${path} is not what it was before the mutation — ${String(error)}`);
  }
}

/**
 * Run `body` with the mutation applied to `path`, and put the file back afterwards.
 *
 * `applyMutationText` runs before anything is written, so an anchor that no longer matches fails
 * without touching the file and without running the body at all.
 */
export async function withMutatedFile<T>(
  path: string,
  find: string,
  replace: string,
  body: () => Promise<T>,
): Promise<T> {
  const original = await readFile(path, "utf8");
  const mutated = applyMutationText(original, find, replace, path);

  // Whether *our* write completed. It is the only way to tell our own half-written file from a
  // file something else has since taken over — by content the two look identical.
  let landed = false;

  // A signal skips `finally` entirely, which is how a killed run left a defect sitting in `src/`
  // on #78. Synchronous, because an async write does not finish inside a signal handler.
  //
  // Its reach is narrower than it looks, and this was measured rather than assumed: on Windows
  // neither `Bun.Subprocess.kill()` nor `process.kill(pid, "SIGINT")` runs these handlers —
  // `handlerRan=false` for both. **A programmatic kill, which is what actually happened on #78,
  // is therefore no more covered than SIGKILL.** This helps a console Ctrl-C and nothing else,
  // so it is a convenience, not the mechanism. The mechanism is the caller's clean-tree check.
  const signals = ["SIGINT", "SIGTERM"] as const;
  const restoreOnSignal = (signal: (typeof signals)[number]): void => {
    restoreIfOurs(path, original, mutated, landed);
    for (const each of signals) process.off(each, restoreOnSignal);
    // The exit decision belongs to whoever owns the process, not to this helper: `mutate.ts` has
    // its own handler that drains the batch and prints a summary, and hard-exiting here would make
    // that unreachable. Re-raise only when nothing else is listening.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  for (const each of signals) process.on(each, restoreOnSignal);

  try {
    await writeFile(path, mutated, "utf8");
    // Read back before running anything. A write that reports success but does not land leaves the
    // work measuring unmutated code, which reads as "the defect made no difference".
    if ((await readFile(path, "utf8")) !== mutated) {
      throw new MutationNotAppliedError(`the file on disk did not change in ${path}`);
    }
    landed = true;
    return await body();
  } finally {
    for (const each of signals) process.off(each, restoreOnSignal);
    restoreIfOurs(path, original, mutated, landed);
  }
}
