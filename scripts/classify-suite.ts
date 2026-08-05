import { APPLIED_TOKEN, NOT_APPLIED_TOKEN } from "./mutation-hook.ts";

export type SuiteVerdict = "NOT_APPLIED" | "SURVIVED" | "CAUGHT" | "CAUGHT_BY_THE_WRONG_TEST";

/**
 * What one mutation run means.
 *
 * The order is the safety property, not a style choice. Since #82 the defect is applied inside the
 * child process, so a corpus entry whose anchor has rotted fails *there* — and a dying suite can
 * easily have already printed the name of the test that was supposed to catch the mutation. Asking
 * about `expect` first would then report CAUGHT for a corpus that no longer applies to the code,
 * which is the exact false green #53 was built to refuse.
 */
export function classifySuiteResult(output: string, exitCode: number, expected: string): SuiteVerdict {
  if (output.includes(NOT_APPLIED_TOKEN)) return "NOT_APPLIED";
  // Absence of the positive token is also NOT APPLIED, and this is the half that is easy to miss:
  // a hook only fires when something loads the file, so an entry whose target no test imports
  // would otherwise report SURVIVED — a plausible result from a defect that never existed.
  if (!output.includes(APPLIED_TOKEN)) return "NOT_APPLIED";
  if (exitCode === 0) return "SURVIVED";
  return output.includes(expected) ? "CAUGHT" : "CAUGHT_BY_THE_WRONG_TEST";
}
