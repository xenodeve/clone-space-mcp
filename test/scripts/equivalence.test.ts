import { describe, expect, test } from "bun:test";
import {
  equivalenceExitCode,
  formatEquivalenceReport,
  parseEquivalenceArgs,
  RUN_FAILED_EXIT,
} from "../../scripts/equivalence.ts";
import type { EquivalenceReport } from "../../src/equivalence/run.ts";

/**
 * #171 acceptance criterion 5 — *"One command runs capture → replay → diff on a URL and exits
 * non-zero on an unexplained residual."*
 *
 * The gate has existed since #171's first slice and has only ever been reachable from a test or a
 * throwaway probe, so every verdict this repo has quoted came from a script nobody else can run.
 * These cover the part a browser is not needed for: what the command **says** and what it **exits
 * with**, which is the half a caller scripts against.
 */

const report = (over: Partial<EquivalenceReport> = {}): EquivalenceReport => ({
  url: "https://example.com/",
  archive: "/tmp/archive",
  fields: [],
  residual: [],
  unstable: [],
  baselinePasses: { live: 3, replay: 3 },
  verdict: "PASS",
  // `coverageOf` returns **whole percentages already rounded** (`classify.ts:242-249`), not
  // ratios. This fixture said `1` when it meant 100 and the formatter multiplied by 100 again,
  // printing `10000%` — caught by running the command, not by these tests, because the expected
  // value had been assumed rather than read from the function that produces it.
  coverage: { scroll: 100, interaction: 0, listener_execution: 0 },
  ...over,
});

/**
 * Three outcomes, three codes. A boolean would fold *"the clone differs"* into *"the run could not
 * measure"*, and those call for opposite next actions — one is a bug to chase, the other is a run
 * to repeat. `bun run ci:lock` already answers in three states for the same reason.
 */
/**
 * A run that **threw** is not a run that found a difference, and before a delegated review caught
 * it the two shared exit `1`: `main` was awaited at module top level, so any exception — a capture
 * refusing a private address, a network failure — rejected the top-level await and Node exited 1,
 * which this command documents as *"a residual to chase"*.
 */
describe("RUN_FAILED_EXIT", () => {
  test("is distinct from all three verdict codes", () => {
    const verdicts = (["PASS", "FAIL", "INCOMPLETE"] as const).map(equivalenceExitCode);
    expect(verdicts).not.toContain(RUN_FAILED_EXIT);
    expect(RUN_FAILED_EXIT).toBeGreaterThan(0);
  });
});

describe("equivalenceExitCode", () => {
  test("PASS is the only zero", () => {
    expect(equivalenceExitCode("PASS")).toBe(0);
  });

  test("FAIL is 1 — a residual nothing explains", () => {
    expect(equivalenceExitCode("FAIL")).toBe(1);
  });

  test("INCOMPLETE is 2, not 0 — nothing was proven equal", () => {
    // The issue's own words: "A residual is empty or the verdict is not PASS — no partial credit."
    // A caller reading 0 here would be told the clone agreed when the run never compared.
    expect(equivalenceExitCode("INCOMPLETE")).toBe(2);
  });
});

describe("formatEquivalenceReport", () => {
  test("names the verdict and the URL it is about", () => {
    const text = formatEquivalenceReport(report({ verdict: "PASS" }));
    expect(text).toContain("PASS");
    expect(text).toContain("https://example.com/");
  });

  test("prints coverage as one line per dimension", () => {
    // Criterion 3: "Coverage is a vector; no code path reduces it to one number." A single
    // number averages away exactly the dimension that is weak — here, two zeroes hidden behind
    // a 33%.
    const text = formatEquivalenceReport(report());
    for (const dimension of ["scroll", "interaction", "listener_execution"]) {
      expect(text).toContain(dimension);
    }
    expect(text).not.toContain("33%");
  });

  test("prints a coverage value in the units coverageOf produces", () => {
    const text = formatEquivalenceReport(report({ coverage: { scroll: 100, interaction: 0 } }));
    expect(text).toContain("100%");
    expect(text).not.toContain("10000%");
  });

  /**
   * A `FAIL` that names a field and not its two values sends the reader to dig through an archive
   * for the one number the run already had in hand. Measured on `www.chaingpt.org`: the report said
   * `residual (1) network.origins` and nothing about what the two sides counted.
   */
  test("a residual field is printed with what each side measured", () => {
    const text = formatEquivalenceReport(
      report({
        verdict: "FAIL",
        residual: ["network.origins"],
        fields: [
          { field: "network.origins", verdict: "different", live: 11, replay: 9 },
          { field: "dom.title", verdict: "equal" },
        ],
      }),
    );
    expect(text).toMatch(/network\.origins.*live 11.*replay 9/s);
  });

  test("a residual field the fields list has no entry for is still named", () => {
    // Losing the field entirely because its values are missing would be worse than losing the
    // values: the verdict would name a count it does not explain.
    const text = formatEquivalenceReport(
      report({ verdict: "FAIL", residual: ["mystery"], fields: [] }),
    );
    expect(text).toContain("mystery");
  });

  test("lists every residual field, because that is what a FAIL is", () => {
    const text = formatEquivalenceReport(
      report({ verdict: "FAIL", residual: ["dom.elements", "layout.scrollHeight"] }),
    );
    expect(text).toContain("dom.elements");
    expect(text).toContain("layout.scrollHeight");
  });

  test("reports the unstable fields rather than dropping them", () => {
    // A field the run could not measure twice the same way carried no signal. Silently omitting
    // it makes the remaining agreement look like a larger claim than it is.
    const text = formatEquivalenceReport(
      report({ verdict: "INCOMPLETE", unstable: ["motion.gsap.settled"] }),
    );
    expect(text).toContain("motion.gsap.settled");
  });

  /**
   * Absent and empty are different claims. `perturbed (0)` says the control ran and the hooks moved
   * nothing; printing that line when nobody drove the control would be reporting a measurement
   * that was never taken.
   */
  test("says nothing about perturbation when the control did not run", () => {
    expect(formatEquivalenceReport(report())).not.toContain("perturbed");
  });

  test("names the fields the hooks moved when the control did run", () => {
    const text = formatEquivalenceReport(report({ perturbed: ["dom.elements"] }));
    expect(text).toContain("perturbed (1)");
    expect(text).toContain("dom.elements");
  });

  test("distinguishes a control that found nothing from one that never ran", () => {
    expect(formatEquivalenceReport(report({ perturbed: [] }))).toContain("perturbed (0)");
  });

  test("prints how much evidence the stability baseline had", () => {
    // #187. A FAIL resting on no replay passes and one resting on three agreeing replay passes
    // are different claims, and the number is the only thing that separates them.
    const text = formatEquivalenceReport(
      report({ verdict: "FAIL", residual: ["a"], baselinePasses: { live: 2, replay: 0 } }),
    );
    expect(text).toMatch(/live 2/);
    expect(text).toMatch(/replay 0/);
  });
});

/**
 * Two positional values and one flag. The flag earns its place by being the only way the exit-code
 * wiring can be exercised without a live site.
 */
describe("parseEquivalenceArgs", () => {
  test("takes the url and an output directory", () => {
    expect(parseEquivalenceArgs(["https://example.com/", "./out/run"])).toEqual({
      url: "https://example.com/",
      outDir: "./out/run",
      allowPrivateNetwork: false,
      measurePerturbation: false,
    });
  });

  test("refuses a missing url rather than capturing something else", () => {
    expect(() => parseEquivalenceArgs([])).toThrow(/url/);
  });

  test("refuses a url that is not one", () => {
    // `captureHar` would fail later and less clearly; a caller should be told here rather than
    // after a browser launch and a live page load.
    expect(() => parseEquivalenceArgs(["not-a-url"])).toThrow(/url/);
    expect(() => parseEquivalenceArgs(["ftp://example.com/"])).toThrow(/url/);
  });

  test("a mistyped flag is named as a flag, not reported as a bad url", () => {
    // `--out` used to reach the URL check and be refused as "not an http(s) url", which sends the
    // reader to inspect a URL that was never the problem.
    expect(() => parseEquivalenceArgs(["--out", "./out/run"])).toThrow(/unknown flag --out/);
  });

  test("defaults the output directory rather than writing where it was invoked", () => {
    expect(parseEquivalenceArgs(["https://example.com/"]).outDir).toMatch(/archives/);
  });

  /**
   * The one flag, and it exists so the wiring can be tested at all. `captureHar` refuses a private
   * address by default (#162) and this repo's fixture is loopback, so without it the only thing
   * that could exercise the command end to end is a live site — which is how the exit-code wiring
   * would have stayed uncovered.
   */
  test("takes --allow-private-network, and defaults to refusing", () => {
    expect(parseEquivalenceArgs(["https://example.com/"]).allowPrivateNetwork).toBe(false);
    expect(
      parseEquivalenceArgs(["https://example.com/", "./out", "--allow-private-network"])
        .allowPrivateNetwork,
    ).toBe(true);
  });

  /**
   * Found by a delegated review before this shipped. A mistyped flag is the case that matters:
   * `--allow-private-networks` is not the flag, was silently accepted as the **output directory**,
   * and left private networking off — so the caller gets a refusal they asked not to have, with no
   * hint that their argument was ignored.
   */
  test("refuses an unknown flag instead of taking it as a path", () => {
    expect(() => parseEquivalenceArgs(["https://example.com/", "--allow-private-networks"])).toThrow(
      /unknown/i,
    );
  });

  test("refuses a third positional rather than ignoring it", () => {
    expect(() => parseEquivalenceArgs(["https://example.com/", "./out", "extra"])).toThrow(
      /unexpected/i,
    );
  });

  /**
   * #171's third drive mode reaches the command by the same door as the first flag, and the parser
   * has to learn it: an unknown `--flag` is refused by name, so adding an option means adding it to
   * the set rather than loosening the check.
   */
  test("takes --measure-perturbation, and defaults to off", () => {
    expect(parseEquivalenceArgs(["https://example.com/"]).measurePerturbation).toBe(false);
    expect(
      parseEquivalenceArgs(["https://example.com/", "--measure-perturbation"]).measurePerturbation,
    ).toBe(true);
  });

  test("both flags can be given together", () => {
    const args = parseEquivalenceArgs([
      "https://example.com/",
      "./out",
      "--measure-perturbation",
      "--allow-private-network",
    ]);
    expect(args).toEqual({
      url: "https://example.com/",
      outDir: "./out",
      allowPrivateNetwork: true,
      measurePerturbation: true,
    });
  });

  test("the flag is not mistaken for the output directory", () => {
    const args = parseEquivalenceArgs(["https://example.com/", "--allow-private-network"]);
    expect(args.allowPrivateNetwork).toBe(true);
    expect(args.outDir).toMatch(/archives/);
  });
});
