/**
 * The inspector — layer 4 of #8, and the one that needs no agent at all.
 *
 * #8's argument: if the only way to see what an archive contains is to ask an agent, then every
 * question about whether a capture is any good needs an agent in the loop. Layers 1–3 removed that
 * dependency for machines. This removes it for **a person who just wants to look**.
 *
 * A pure function of data to a string. No filesystem, no browser, no network — so it is testable
 * without any of them, and the page it produces opens from disk with nothing to load.
 */

import type { InspectArchiveResult } from "./tools/inspect-archive.ts";
import type { BehaviourGraph } from "../extract/behaviour.ts";

export interface InspectorReport {
  archive: InspectArchiveResult;
  /** Present once the archive has been replayed and extracted; absent is a legitimate state. */
  behaviour?: BehaviourGraph & { aborted: string[] };
  /** What the site was declared to have, when a fixture manifest is available to compare against. */
  declared?: { id: string; mechanism: string; selector: string; kind: string }[];
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * Found versus declared, as two lists that can disagree.
 *
 * #8 names this as the question the project has to answer before an agent ever reads an archive:
 * *"the extractor found 12 animations" is not an answer without something to compare it against.*
 * A declared case with no extracted node targeting its selector is the gap, and it is shown as a
 * row rather than implied by a count.
 */
function foundVersusDeclared(report: InspectorReport): { id: string; mechanism: string; found: boolean }[] {
  const declared = (report.declared ?? []).filter((entry) => entry.kind === "animation");
  const nodes = report.behaviour?.nodes ?? [];
  return declared.map((entry) => ({
    id: entry.id,
    mechanism: entry.mechanism,
    found: nodes.some((node) => node.target === entry.selector),
  }));
}

export function renderInspector(report: InspectorReport): string {
  const { archive } = report;
  const gaps = foundVersusDeclared(report);

  const contractRows = archive.contracts
    .map(
      (contract) =>
        `<tr class="${contract.status}"><td>${escapeHtml(contract.section)}</td><td>${escapeHtml(contract.name)}</td><td>${escapeHtml(contract.artifact ?? "—")}</td><td>${contract.status}</td></tr>`,
    )
    .join("");

  const behaviourRows = (report.behaviour?.nodes ?? [])
    .map(
      (node) =>
        `<tr><td>${escapeHtml(node.mechanism)}</td><td><code>${escapeHtml(node.target)}</code></td><td>${escapeHtml(node.library)}</td><td>${escapeHtml(node.easing ?? "—")}</td></tr>`,
    )
    .join("");

  const gapRows = gaps
    .map(
      (gap) =>
        `<tr class="${gap.found ? "present" : "missing"}"><td>${escapeHtml(gap.id)}</td><td>${escapeHtml(gap.mechanism)}</td><td>${gap.found ? "found" : "NOT FOUND"}</td></tr>`,
    )
    .join("");

  const mismatched = archive.integrity.mismatched;
  const abortedCount = report.behaviour?.aborted.length;

  return `<!doctype html>
<meta charset="utf-8">
<title>clone-space archive — ${escapeHtml(archive.root)}</title>
<style>
 body{font:14px/1.5 ui-monospace,monospace;margin:2rem;max-width:60rem}
 h1{font-size:1.2rem} h2{font-size:1rem;margin-top:2rem}
 table{border-collapse:collapse;width:100%} td,th{border:1px solid #ccc;padding:.3rem .5rem;text-align:left}
 .present td:last-child{color:#0a0} .missing td:last-child,.missing{color:#c00;font-weight:bold}
 .not-produced td:last-child{color:#888}
 .verdict{padding:.5rem .8rem;border:2px solid;display:inline-block}
 .ok{border-color:#0a0;color:#0a0} .bad{border-color:#c00;color:#c00}
</style>
<h1>${escapeHtml(archive.root)}</h1>
<p class="verdict ${archive.complete ? "ok" : "bad"}">${archive.complete ? "intact" : "NOT INTACT"}</p>
${mismatched.length > 0 ? `<p class="missing">artifacts that no longer match the commit: ${mismatched.map(escapeHtml).join(", ")}</p>` : ""}
<p>terminated <strong>${escapeHtml(archive.termination.outcome)}</strong>${archive.termination.reason ? ` (${escapeHtml(archive.termination.reason)})` : ""}${abortedCount === undefined ? "" : ` · replay could not serve <strong>${abortedCount}</strong> request(s)`}</p>

<h2>Archive contracts</h2>
<table><tr><th>§</th><th>contract</th><th>artifact</th><th>status</th></tr>${contractRows}</table>

${gaps.length > 0 ? `<h2>Found versus declared</h2><table><tr><th>case</th><th>mechanism</th><th>result</th></tr>${gapRows}</table>` : ""}

${behaviourRows.length > 0 ? `<h2>Behaviour</h2><table><tr><th>mechanism</th><th>target</th><th>library</th><th>easing</th></tr>${behaviourRows}</table>` : "<h2>Behaviour</h2><p>Not extracted. Run <code>extract_behaviour</code> to fill this in.</p>"}
`;
}
