/** Non-overlapping occurrences, the same notion `applyMutationText` enforces. */
export function countOccurrences(content: string, find: string): number {
  return content.split(find).length - 1;
}

/**
 * Apply one text mutation to module source, or fail loudly.
 *
 * A mutation that does not apply must never look like a mutation that made no difference. The
 * anchor is required to match exactly once: zero means it has rotted (a fix moved the text, or the
 * pattern was written with the wrong line endings), and more than once means the anchor does not
 * identify a single site.
 *
 * Since #82 this is the whole module. The apply/restore lifecycle it used to sit inside is gone,
 * because the defect is now applied to the source a runtime is loading rather than to the file on
 * disk — so there is nothing to put back, and no window in which a killed process can leave the
 * working tree carrying a known defect.
 */
export function applyMutationText(content: string, find: string, replace: string, file: string): string {
  const occurrences = countOccurrences(content, find);
  if (occurrences !== 1) {
    throw new Error(`find text occurs ${occurrences} times in ${file}, expected 1`);
  }

  const mutated = content.replace(find, replace);
  if (mutated === content) {
    throw new Error(`the replacement changes nothing in ${file}`);
  }
  return mutated;
}
