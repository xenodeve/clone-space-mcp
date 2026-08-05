import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  reconcile,
  type ElementFingerprint,
  type IdentitySnapshot,
} from "../src/identity/reconcile.ts";
import { fingerprintKey } from "../src/identity/fingerprint.ts";
import { withMutatedFile } from "./mutation-apply.ts";
import { MUTATIONS } from "./mutations.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const N = 400;
const BASELINE = 32;
const SEED = 0x24_08_04_26;

const TAGS = ["article", "button", "div", "header", "li", "nav", "p", "section", "span"];
const ATTRS: Record<string, string>[] = [
  {},
  { class: "card" },
  { class: "item" },
  { "data-role": "content" },
  { "data-role": "item" },
  { "aria-label": "next" },
];
const TEXT_HASHES = [null, "alpha", "beta", "gamma"] as const;

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

interface LogicalElement {
  parentIndex: number | null;
  tag: string;
  attrs: Record<string, string>;
  textHash: string | null;
}

function makeLogicalElements(random: SeededRandom): LogicalElement[] {
  const elements: LogicalElement[] = [];
  const count = 5 + random.int(12);

  for (let index = 0; index < count; index++) {
    elements.push({
      parentIndex: index === 0 || random.chance(0.28) ? null : random.int(index),
      tag: random.pick(TAGS),
      attrs: { ...random.pick(ATTRS) },
      textHash: random.pick(TEXT_HASHES),
    });
  }

  return elements;
}

function materialize(
  logical: readonly LogicalElement[],
  idOffset: number,
  textChanges: readonly (string | null)[] = logical.map((element) => element.textHash),
): IdentitySnapshot {
  const ids = logical.map((_, index) => `wa:0:${idOffset + index}`);
  const siblingOrdinals = new Map<string, number>();
  const elements: ElementFingerprint[] = logical.map((element, index) => {
    const parentId = element.parentIndex === null ? null : ids[element.parentIndex]!;
    const ordinalKey = `${parentId ?? "root"}|${element.tag}`;
    const siblingOrdinal = siblingOrdinals.get(ordinalKey) ?? 0;
    siblingOrdinals.set(ordinalKey, siblingOrdinal + 1);

    return {
      id: ids[index]!,
      frameKey: "0",
      tag: element.tag,
      attrs: { ...element.attrs },
      siblingOrdinal,
      textHash: textChanges[index]!,
      parentId,
    };
  });

  return { schemaVersion: 1, elements };
}

function makePair(random: SeededRandom): { capture: IdentitySnapshot; replay: IdentitySnapshot } {
  const logical = makeLogicalElements(random);
  const capture = materialize(logical, 1);
  const replayText = logical.map((element) =>
    random.chance(0.2) ? random.pick(TEXT_HASHES) : element.textHash,
  );
  const replay = materialize(logical, 1_000, replayText);
  return { capture, replay };
}

function addUnrelatedNode(replay: IdentitySnapshot, random: SeededRandom, caseIndex: number): IdentitySnapshot {
  const source = random.pick(replay.elements);
  const siblings = replay.elements.filter(
    (element) => element.parentId === source.parentId && element.tag === source.tag,
  );
  const insertionOrdinal = random.int(siblings.length + 1);
  const elements = replay.elements.map((element) => {
    if (element.parentId !== source.parentId || element.tag !== source.tag) return element;
    return element.siblingOrdinal >= insertionOrdinal
      ? { ...element, siblingOrdinal: element.siblingOrdinal + 1 }
      : element;
  });

  elements.push({
    ...source,
    attrs: {
      ...source.attrs,
      "data-metamorphic-unrelated": `case-${caseIndex}`,
    },
    id: `wa:0:${10_000 + caseIndex}`,
    siblingOrdinal: insertionOrdinal,
  });
  return { ...replay, elements };
}

function assertUnmatchable(injected: ElementFingerprint, capture: IdentitySnapshot): void {
  const injectedKey = fingerprintKey(injected);
  const collisions = capture.elements.filter((element) => fingerprintKey(element) === injectedKey);
  if (collisions.length > 0) {
    throw new Error(
      `HARNESS FAILURE: injected node ${injected.id} fingerprintKey collides with capture: ${collisions
        .map((element) => element.id)
        .join(", ")}`,
    );
  }
}

function measure(): number {
  const random = new SeededRandom(SEED);
  let dropCount = 0;

  for (let caseIndex = 0; caseIndex < N; caseIndex++) {
    const { capture, replay } = makePair(random);
    const perturbed = addUnrelatedNode(replay, random, caseIndex);
    const injectedId = `wa:0:${10_000 + caseIndex}`;
    const injected = perturbed.elements.find((element) => element.id === injectedId);
    if (!injected) {
      throw new Error(`HARNESS FAILURE: injected node ${injectedId} was not created`);
    }
    assertUnmatchable(injected, capture);
    const before = reconcile(capture, replay).matched.length;
    const after = reconcile(capture, perturbed).matched.length;
    if (after < before) dropCount++;
  }

  return dropCount;
}

function report(dropCount: number): void {
  const delta = dropCount - BASELINE;
  const deltaLabel = delta >= 0 ? `+${delta}` : `${delta}`;
  console.log("METAMORPHIC CHECK: baseline metric for reconcile (not an assertion)");
  console.log(`seed: 0x${SEED.toString(16).padStart(8, "0")}`);
  console.log(`N: ${N}`);
  console.log(`drop count: ${dropCount}/${N}`);
  console.log(`#24 historical figure: ${BASELINE}/${N}`);
  console.log(`nominal delta: ${deltaLabel}/${N}`);
  // The two numbers describe different corpora. #24's figure was measured on a corpus this repo
  // no longer contains, so the delta above is not drift in reconcile — comparing it as though it
  // were is the false confidence this check exists to avoid. The comparable baseline is a prior
  // run of THIS harness at THIS seed.
  console.log("NOT COMPARABLE: #24's figure came from a different corpus. Compare only against a");
  console.log("prior run of this harness at the same seed.");
  console.log("A non-zero count is expected and legitimate; drift is information for a human, not a gate.");
}

/**
 * Measure the same 400 cases twice: once against the current code, once with a defect that
 * actually happened put back. `CLAUDE.md` treats a safety mechanism as unproven until it has
 * been run against a real bug, and this is how that run is made repeatable rather than a
 * one-off someone did by hand and described afterwards.
 */
async function measureAgainst(mutationId: string): Promise<void> {
  const mutation = MUTATIONS.find(({ id }) => id === mutationId);
  if (!mutation) {
    throw new Error(`unknown mutation id "${mutationId}" — the ids live in scripts/mutations.ts`);
  }

  const fixed = measure();
  const restored = await withMutatedFile(
    resolve(repoRoot, mutation.file),
    mutation.find,
    mutation.replace,
    async () => {
      // A child process, because this one imported the module being mutated long before the
      // mutation was written; re-importing it here would return the cached, unmutated copy.
      // `--emit-count` rather than reading the human report back: the report is written for a
      // person and its wording is free to change, which would silently break this measurement.
      const child = Bun.spawn([process.execPath, "scripts/metamorphic.ts", "--emit-count"], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(`the run with the defect restored exited ${exitCode}:\n${stdout}\n${stderr}`);
      }

      const count = Number(stdout.trim());
      if (!Number.isInteger(count)) {
        throw new Error(`the run with the defect restored printed no drop count:\n${stdout}`);
      }
      return count;
    },
  );

  console.log("METAMORPHIC DISCRIMINATION: measured against a defect that actually happened");
  console.log(`seed: 0x${SEED.toString(16).padStart(8, "0")}`);
  console.log(`N: ${N}`);
  console.log(`mutation: ${mutation.id}`);
  console.log(`fixed code: ${fixed}/${N}`);
  console.log(`defect restored: ${restored}/${N}`);
  // Deliberately no ratio. With a floor this low a single case moves restored/fixed by tens,
  // so the multiplier reads as a precise statistic while being almost entirely denominator
  // noise. The two absolute counts are the finding; anything derived from them is not.
  console.log("Read the two counts, not a ratio between them: the fixed floor is too small to");
  console.log("divide by. Counts that barely differ mean this check cannot see that defect —");
  console.log("a result to record, not a failure. This stays a metric and never a gate.");
}

const againstIndex = process.argv.indexOf("--against");

try {
  if (process.argv.includes("--emit-count")) {
    // The machine-readable contract the `--against` parent depends on: the count and nothing else.
    console.log(measure());
  } else if (againstIndex === -1) {
    report(measure());
  } else {
    const requested = process.argv[againstIndex + 1];
    if (requested === undefined) {
      throw new Error("--against needs a mutation id from scripts/mutations.ts");
    }
    await measureAgainst(requested);
  }
} catch (error) {
  console.error("metamorphic harness failed:", error);
  process.exitCode = 1;
}
