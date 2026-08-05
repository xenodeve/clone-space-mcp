import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One definition, because the alternative is each file hand-counting its own `".."` depth — and a
 * file that moves then resolves paths one directory off instead of failing.
 */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
