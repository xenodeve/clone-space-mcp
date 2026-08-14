/**
 * Write the inspector page for an archive (#128).
 *
 *   node scripts/inspect.ts ./out/a [--no-extract] [-o report.html]
 *
 * Node rather than Bun, because extracting the behaviour graph replays the archive in a real
 * browser (ADR 0001). `--no-extract` skips that and reports the archive alone, which needs no
 * browser at all.
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { renderInspector, type InspectorReport } from "../src/serve/inspector.ts";
import { inspectArchive } from "../src/serve/tools/inspect-archive.ts";
import { extractBehaviourFromArchive } from "../src/serve/tools/extract-behaviour.ts";
import { readFileSync, existsSync } from "node:fs";
import { repoRoot } from "./repo-root.ts";

const args = process.argv.slice(2);
const archivePath = args.find((arg) => !arg.startsWith("-"));
if (archivePath === undefined) {
  process.stderr.write("usage: node scripts/inspect.ts <archive> [--no-extract] [-o out.html]\n");
  process.exit(2);
}
const outIndex = args.indexOf("-o");
const outPath = resolve(outIndex === -1 ? join(archivePath, "inspector.html") : args[outIndex + 1]!);

const report: InspectorReport = { archive: await inspectArchive({ path: archivePath }) };

// The fixture's own ground truth, when this is a capture of it. Found-versus-declared is only a
// question if something declared what should be there.
const manifestPath = join(repoRoot, "test/fixtures/motion-site/fixture-manifest.json");
if (existsSync(manifestPath)) {
  report.declared = (JSON.parse(readFileSync(manifestPath, "utf8")) as { declares: [] }).declares;
}

if (!args.includes("--no-extract")) {
  report.behaviour = await extractBehaviourFromArchive({ archive: archivePath }, {
    launch: () => chromium.launch() as never,
  });
}

writeFileSync(outPath, renderInspector(report));
process.stdout.write(`${outPath}\n`);
