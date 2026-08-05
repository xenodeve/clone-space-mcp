import type { Mutation } from "./mutations.ts";

/**
 * The part of `src` the metamorphic harness actually executes. A mutation outside it would be
 * applied faithfully and measured by nothing, and the two equal counts that came back would read
 * like evidence that the metric cannot see a real defect.
 */
const MEASURED_PREFIX = "src/identity/";

export type Mode =
  | { kind: "report" }
  | { kind: "emit-count" }
  | { kind: "against"; mutationId: string };

export function parseMode(argv: readonly string[]): Mode {
  const againstIndex = argv.indexOf("--against");
  if (againstIndex === -1) {
    return argv.includes("--emit-count") ? { kind: "emit-count" } : { kind: "report" };
  }

  // The id is validated before the combination check on purpose: `--against --emit-count` is a
  // missing id, not a request for two modes, and saying so is the more useful of the two errors.
  const mutationId = argv[againstIndex + 1];
  if (mutationId === undefined || mutationId.startsWith("--")) {
    throw new Error("--against needs a mutation id from scripts/mutations.ts");
  }
  if (argv.includes("--emit-count")) {
    throw new Error("--emit-count and --against cannot be combined: they are different runs");
  }
  return { kind: "against", mutationId };
}

/**
 * `Number("")` is 0 and `Number.isInteger(0)` is true, so accepting whatever the child printed
 * turns a run that measured nothing into a published `0/N`. The grammar is deliberately strict.
 */
export function parseDropCount(stdout: string, cases: number): number {
  const trimmed = stdout.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`the run with the defect restored printed no drop count:\n${stdout}`);
  }

  const count = Number(trimmed);
  if (count > cases) {
    throw new Error(`the run with the defect restored printed ${count}, out of range for ${cases} cases`);
  }
  return count;
}

export function resolveMeasurableMutation(mutations: readonly Mutation[], id: string): Mutation {
  const mutation = mutations.find((candidate) => candidate.id === id);
  if (!mutation) {
    throw new Error(`unknown mutation id "${id}" — the ids live in scripts/mutations.ts`);
  }
  if (!mutation.file.startsWith(MEASURED_PREFIX)) {
    throw new Error(
      `mutation "${id}" rewrites ${mutation.file}, but this harness only exercises ${MEASURED_PREFIX} — ` +
        "measuring it would report two equal counts from code the run never executed",
    );
  }
  return mutation;
}
