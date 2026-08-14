/**
 * Perform an interaction plan against a page (#176, slice 3 of #169).
 *
 * The plan is decided by the pure policy in `./interaction.ts`; this module only carries it out and
 * says what happened. It is separate because it needs a page, and the repo keeps the rules where a
 * `bun test` can reach them.
 *
 * **The postcondition is the point.** The policy refuses what it can *predict* will navigate or
 * submit; a page can still navigate from a handler no attribute declares. So the driver checks the
 * document URL after every action, and on a change it stops and records it. Continuing would drive
 * the remaining selectors against a document they were never discovered on — the actions would
 * still "succeed", and the transcript would be a fiction.
 */

import { isStale, type InteractionPlan, type ObservedElement, type PlannedAction } from "./interaction.ts";

export const INTERACTION_DRIVE_SCHEMA_VERSION = 1;

/** The slice of a Playwright `Page` this module uses. Narrow, so a test can supply a fake. */
export interface DrivablePage {
  url(): string;
  hover(selector: string, options?: { timeout?: number }): Promise<void>;
  focus(selector: string, options?: { timeout?: number }): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  evaluate<T>(fn: (selector: string) => T, arg: string): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
}

/**
 * Read back every fact the policy judges, for the element the selector resolves to *now*.
 *
 * Each read must match `DISCOVERY_SCRIPT`'s exactly. `||` rather than `??` on the label is not a
 * style choice: `getAttribute` returns `""` for `aria-label=""`, which is not null, so `??` would
 * keep the empty string where discovery falls through to `title` — and every such element would
 * then report stale.
 */
function observeElement(selector: string): ObservedElement {
  const element = document.querySelector(selector);
  if (!element) {
    return {
      found: false,
      tag: "",
      role: "",
      label: "",
      type: "",
      href: "",
      target: "",
      download: false,
      inForm: false,
      sameOrigin: true,
    };
  }
  const attributed = element.getAttribute("aria-label") || element.getAttribute("title") || "";
  const text = attributed !== "" ? attributed : (element as HTMLElement).innerText || "";
  const href = element.getAttribute("href") || element.getAttribute("action") || "";
  let sameOrigin = true;
  if (href !== "") {
    try {
      sameOrigin = new URL(href, location.href).origin === location.origin;
    } catch {
      sameOrigin = false;
    }
  }
  return {
    found: true,
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute("role") || "",
    label: text.slice(0, 120),
    type: (element.getAttribute("type") || "").toLowerCase(),
    href: element.getAttribute("href") || "",
    target: element.getAttribute("target") || "",
    download: element.hasAttribute("download"),
    inForm:
      (element as HTMLButtonElement).form instanceof HTMLFormElement ||
      element.closest("form") !== null,
    sameOrigin,
  };
}

export interface ActionResult {
  kind: PlannedAction["kind"];
  selector: string;
  /** Whether the action was performed. A miss is not a failure of the run — it is a fact about it. */
  ok: boolean;
  /** Empty when `ok`; otherwise the first line of what went wrong. */
  note: string;
}

export interface DriveReport {
  schemaVersion: typeof INTERACTION_DRIVE_SCHEMA_VERSION;
  performed: ActionResult[];
  /** The URL the plan was discovered against. */
  startedAt: string;
  /** Set when the document navigated mid-plan; the plan is abandoned at that point. */
  navigatedTo: string;
  /** Actions never attempted because the run stopped. Never silently dropped. */
  abandoned: number;
}

export interface DriveOptions {
  /** Per-action timeout. A target that is covered or animating away must not stall the run. */
  actionTimeoutMs?: number;
  /** Settle time after each action, so the effect it triggers is observable before the next one. */
  settleMs?: number;
}

const DEFAULT_ACTION_TIMEOUT_MS = 2_000;
const DEFAULT_SETTLE_MS = 120;

/**
 * Scroll a nested container by one viewport of its own.
 *
 * This is a **function**, not an expression string. Playwright accepts both, and the string form of
 * this exact body ran without performing the assignment — `scrollTop` read back 0 where the
 * function form read back 40 on the same element. The failure is silent: `evaluate` resolves, the
 * action reports `ok`, and the only symptom is that nothing scrolled.
 */
function scrollContainer(selector: string): void {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`no element for ${selector}`);
  element.scrollTop = Math.min(element.scrollTop + element.clientHeight, element.scrollHeight);
  element.scrollLeft = Math.min(element.scrollLeft + element.clientWidth, element.scrollWidth);
}

async function perform(
  page: DrivablePage,
  action: PlannedAction,
  timeout: number,
): Promise<void> {
  if (action.kind === "scroll") {
    await page.evaluate(scrollContainer, action.selector);
    return;
  }
  if (action.kind === "hover") return page.hover(action.selector, { timeout });
  if (action.kind === "focus") return page.focus(action.selector, { timeout });
  return page.click(action.selector, { timeout });
}

/**
 * Run a plan in order and report what happened. The plan's order is already least-destructive
 * first; this module does not reorder it, because the two halves would then disagree about what was
 * driven and the equivalence gate compares transcripts.
 */
export async function driveInteraction(
  page: DrivablePage,
  plan: InteractionPlan,
  options: DriveOptions = {},
): Promise<DriveReport> {
  const timeout = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const settle = options.settleMs ?? DEFAULT_SETTLE_MS;
  const startedAt = page.url();
  const performed: ActionResult[] = [];
  let navigatedTo = "";

  for (const [index, action] of plan.actions.entries()) {
    try {
      // Check the element is still the one the policy judged, before spending an actionability
      // timeout on it and before activating it. A stale selector is a fast, honest skip.
      const stale = isStale(action, await page.evaluate(observeElement, action.selector));
      if (stale !== "") {
        performed.push({ kind: action.kind, selector: action.selector, ok: false, note: stale });
        continue;
      }
      await perform(page, action, timeout);
      performed.push({ kind: action.kind, selector: action.selector, ok: true, note: "" });
    } catch (error) {
      const note = (error as Error).message.split("\n")[0] ?? "unknown failure";
      performed.push({ kind: action.kind, selector: action.selector, ok: false, note });
    }
    await page.waitForTimeout(settle);
    if (page.url() !== startedAt) {
      navigatedTo = page.url();
      return {
        schemaVersion: INTERACTION_DRIVE_SCHEMA_VERSION,
        performed,
        startedAt,
        navigatedTo,
        abandoned: plan.actions.length - index - 1,
      };
    }
  }

  return {
    schemaVersion: INTERACTION_DRIVE_SCHEMA_VERSION,
    performed,
    startedAt,
    navigatedTo,
    abandoned: 0,
  };
}
