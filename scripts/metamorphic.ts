import {
  reconcile,
  type ElementFingerprint,
  type IdentitySnapshot,
} from "../src/identity/reconcile.ts";

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
    id: `wa:0:${10_000 + caseIndex}`,
    siblingOrdinal: insertionOrdinal,
  });
  return { ...replay, elements };
}

function run(): void {
  const random = new SeededRandom(SEED);
  let dropCount = 0;

  for (let caseIndex = 0; caseIndex < N; caseIndex++) {
    const { capture, replay } = makePair(random);
    const before = reconcile(capture, replay).matched.length;
    const after = reconcile(capture, addUnrelatedNode(replay, random, caseIndex)).matched.length;
    if (after < before) dropCount++;
  }

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

try {
  run();
} catch (error) {
  console.error("metamorphic harness failed:", error);
  process.exitCode = 1;
}
