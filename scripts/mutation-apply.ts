import { writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Thrown when the file could not be put into the mutated state — a rotted anchor, or a write
 * that did not land. Callers distinguish it from a failure raised by the work itself, because
 * the two mean opposite things: this one says the corpus is stale, not that the code is wrong.
 */
export class MutationNotAppliedError extends Error {}

/**
 * Apply one text mutation, or fail loudly.
 *
 * A mutation that does not apply must never look like a mutation that made no difference.
 * The anchor is required to match exactly once: zero means it has rotted (a fix moved the
 * text, or the pattern was written with the wrong line endings), and more than once means
 * the anchor does not identify a single site.
 */
export function applyMutationText(content: string, find: string, replace: string, file?: string): string {
  let occurrences = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(find, offset);
    if (index === -1) break;
    occurrences += 1;
    offset = index + find.length;
  }

  if (occurrences !== 1) {
    const where = file === undefined ? "" : ` in ${file}`;
    throw new MutationNotAppliedError(
      `MUTATION NOT APPLIED${where} — find text occurs ${occurrences} times, expected 1`,
    );
  }

  const mutated = content.replace(find, replace);
  if (mutated === content) {
    const where = file === undefined ? "" : ` in ${file}`;
    throw new MutationNotAppliedError(`MUTATION NOT APPLIED${where} — the replacement changes nothing`);
  }
  return mutated;
}

/**
 * Run `body` with the mutation applied to `path`, and put the file back afterwards.
 *
 * The restore is in a `finally`, so a body that throws cannot leave a known defect in the
 * working tree. `applyMutationText` runs before anything is written, so an anchor that no
 * longer matches fails without touching the file and without running the body at all.
 */
export async function withMutatedFile<T>(
  path: string,
  find: string,
  replace: string,
  body: () => Promise<T>,
): Promise<T> {
  const original = await readFile(path, "utf8");
  const mutated = applyMutationText(original, find, replace, path);

  // A signal skips `finally` entirely, which is exactly how a killed run left a defect sitting in
  // `src/` on #78. Synchronous, because an async write does not finish inside a signal handler.
  // SIGKILL is still unreachable from here, and no in-process design closes that.
  const restoreOnSignal = (): void => {
    try {
      writeFileSync(path, original, "utf8");
    } catch {
      // Dying anyway; there is nothing better available at this point.
    }
    process.exit(130);
  };
  process.on("SIGINT", restoreOnSignal);
  process.on("SIGTERM", restoreOnSignal);

  // Whether *our* write completed. It is the only way to tell our own half-written file (restore
  // it) from a file something else has since taken over (leave it alone) — the two look the same.
  let mutationLanded = false;
  try {
    await writeFile(path, mutated, "utf8");
    // Read back before running anything. A write that reports success but does not land leaves
    // the work measuring unmutated code, which reads as "the defect made no difference".
    if ((await readFile(path, "utf8")) !== mutated) {
      throw new MutationNotAppliedError(`MUTATION NOT APPLIED in ${path} — the file on disk did not change`);
    }
    mutationLanded = true;
    return await body();
  } finally {
    process.off("SIGINT", restoreOnSignal);
    process.off("SIGTERM", restoreOnSignal);

    if (!mutationLanded) {
      await writeFile(path, original, "utf8");
    } else if ((await readFile(path, "utf8").catch(() => undefined)) === mutated) {
      await writeFile(path, original, "utf8");
    } else {
      // Restoring here would write *our* idea of the original over someone else's work, and on
      // #78 that is how a second runner put the first runner's mutation back on disk.
      console.error(`RESTORE SKIPPED: ${path} changed while it was mutated — left as found`);
    }
  }
}
