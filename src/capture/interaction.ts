/**
 * Bounded interaction (#176, slice 3 of #169).
 *
 * Everything the pipeline observes today is what a single scroll-through triggers. On
 * `www.chaingpt.org` the instrumentation counted 242 `click` registrations, 214 `keydown` and 72
 * `mouseenter` — every one of them seen as a *registration* and never once as behaviour. The
 * effects a reader most wants explained are usually the ones behind a click.
 *
 * **The load-bearing half of this module is the refusal policy, not the clicking.** A tool an agent
 * points at an arbitrary page must not submit a form, navigate away, start a download, open a file
 * dialog, or press a control whose text suggests deletion, purchase or authentication. `refuse`
 * says which rule stopped a candidate and quotes the fact that tripped it, because a silent skip is
 * indistinguishable from a candidate nobody found — and a coverage number built on silent skips
 * flatters rather than reports.
 *
 * Refusal is per **activation**, not per element. Hovering, focusing and scrolling cannot submit or
 * navigate, so a refused candidate still contributes those; only its click is withheld. Withholding
 * everything would be safer by no measurable amount and would drop exactly the hover-driven motion
 * this project exists to explain.
 *
 * This module is the pure policy plus the in-page discovery script. The driver that performs a plan
 * lives in `src/capture/interaction-drive.ts`, which needs a page.
 */

export const INTERACTION_SCHEMA_VERSION = 1;

export type RefusalRule =
  | "cross-origin"
  | "download"
  | "new-browsing-context"
  | "file-picker"
  | "navigation"
  | "form-submission"
  | "authentication"
  | "destructive-wording";

export type ActionKind = "scroll" | "hover" | "focus" | "click";

/** What discovery reports about one element. Every field is a fact the policy can be checked against. */
export interface Candidate {
  /** A selector that resolved to exactly one element at discovery time. */
  selector: string;
  /** Lowercased tag name. */
  tag: string;
  /** Explicit ARIA role, or "" when the element carries none. */
  role: string;
  /** `aria-label` when present, else the element's own trimmed text. */
  label: string;
  /** Lowercased `type` attribute, or "" — the field that separates a submit from a plain button. */
  type: string;
  /** The `href` attribute as authored, or "". */
  href: string;
  /** The `target` attribute, or "". */
  target: string;
  /** Whether the element carries a `download` attribute. */
  download: boolean;
  /** Whether the element has a `form` ancestor. */
  inForm: boolean;
  /** False when the element points at another origin. */
  sameOrigin: boolean;
  /** The event types this element registered a listener for. */
  listeners: string[];
  /** Whether the element is its own scroll container. */
  scrollable: boolean;
  /** Whether the element takes focus. */
  focusable: boolean;
  /**
   * Whether the element's computed cursor is `pointer`. It is the one hover signal available from
   * structure alone: a page can register a `mouseenter` handler that no attribute records, but a
   * designer who wants a hover response almost always says so in the cursor.
   */
  pointerCursor: boolean;
  /** Document order. The determinism key — array position is not. */
  order: number;
}

export interface Refusal {
  selector: string;
  rule: RefusalRule;
  /** The fact that tripped the rule, quoted, so the record is checkable without re-running. */
  detail: string;
}

export interface PlannedAction {
  kind: ActionKind;
  selector: string;
  order: number;
  /** The tag the policy judged. Carried so the driver can check it is still acting on that element. */
  tag: string;
  /** The label the policy judged, for the same reason. */
  label: string;
}

export interface InteractionLimits {
  /** Maximum actions of any one kind. */
  perKind: number;
  /** Maximum actions overall. */
  total: number;
}

export interface InteractionPlan {
  schemaVersion: typeof INTERACTION_SCHEMA_VERSION;
  /** Every candidate discovery offered, refused or not — so a low action count is readable. */
  discovered: number;
  actions: PlannedAction[];
  refusals: Refusal[];
  /** Per kind, how many actions the bounds dropped. Zero is reported, never omitted. */
  truncated: Record<ActionKind, number>;
}

export const DEFAULT_LIMITS: InteractionLimits = { perKind: 12, total: 32 };

/**
 * Words that make a control too consequential to press. Matched on a word boundary — a substring
 * match refuses "For buyers" for containing "buy", and a policy that cries wolf gets switched off.
 */
const DESTRUCTIVE_TERMS = [
  "delete",
  "remove",
  "erase",
  "buy",
  "purchase",
  "checkout",
  "pay",
  "send",
  "submit",
  "confirm",
  "subscribe",
  "unsubscribe",
  "transfer",
  "withdraw",
  "deposit",
  "approve",
  "publish",
  "deploy",
];

const AUTH_TERMS = [
  "sign in",
  "sign out",
  "sign up",
  "log in",
  "log out",
  "signin",
  "signout",
  "signup",
  "login",
  "logout",
  "register",
  "password",
  "passphrase",
  "seed phrase",
  "wallet",
  "metamask",
  "authenticate",
  "oauth",
  "sso",
  "2fa",
];

/**
 * Thai is matched as a plain substring rather than on a word boundary: Thai does not delimit words
 * with spaces, so `\b` never fires inside a Thai string and an ASCII-only list would refuse
 * "Confirm payment" while allowing "ยืนยันการชำระเงิน".
 */
const DESTRUCTIVE_TERMS_TH = ["ลบ", "ซื้อ", "ชำระเงิน", "ยืนยัน", "ยกเลิก", "โอน", "ถอน", "สมัคร"];
const AUTH_TERMS_TH = ["เข้าสู่ระบบ", "ออกจากระบบ", "สมัครสมาชิก", "รหัสผ่าน", "กระเป๋าเงิน"];

const HOVER_EVENTS: ReadonlySet<string> = new Set([
  "mouseenter",
  "mouseover",
  "mousemove",
  "pointerenter",
  "pointerover",
]);

const CLICK_EVENTS: ReadonlySet<string> = new Set([
  "click",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
]);

/** Least-destructive first, so a click cannot invalidate a target an earlier action still needed. */
const KIND_ORDER: ActionKind[] = ["scroll", "hover", "focus", "click"];

function normalizedLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function matchedTerm(label: string, ascii: string[], thai: string[]): string | undefined {
  const text = normalizedLabel(label);
  for (const term of ascii) {
    if (new RegExp("\\b" + term + "\\b", "u").test(text)) return term;
  }
  return thai.find((term) => text.includes(term));
}

/**
 * The rules, in the order they are reported. Structural facts come before wording: "this anchor
 * leaves the document" is checkable from the DOM, while "this label reads as destructive" is a
 * judgement encoded in a list, and the more checkable reason is the more useful one to record.
 */
const RULES: { rule: RefusalRule; check: (candidate: Candidate) => string | undefined }[] = [
  {
    rule: "cross-origin",
    check: (c) => (c.sameOrigin ? undefined : `points off-origin: ${c.href}`),
  },
  {
    rule: "download",
    check: (c) => (c.download ? "carries a download attribute" : undefined),
  },
  {
    rule: "new-browsing-context",
    check: (c) =>
      c.target !== "" && c.target !== "_self" ? `opens target "${c.target}"` : undefined,
  },
  {
    rule: "file-picker",
    check: (c) =>
      c.tag === "input" && c.type === "file" ? "opens a file dialog the driver cannot dismiss" : undefined,
  },
  {
    rule: "navigation",
    check: (c) => {
      if (c.href === "") return undefined;
      if (c.href.startsWith("#")) return undefined;
      // A `javascript:` href activates script in place; it is not a navigation, and refusing it
      // would withhold exactly the click this module exists to drive.
      if (c.href.toLowerCase().startsWith("javascript:")) return undefined;
      return `href leaves the document: ${c.href}`;
    },
  },
  {
    rule: "form-submission",
    check: (c) => {
      if (c.type === "submit" || c.type === "image") return `control type is "${c.type}"`;
      // A `<button>` with no type submits its form. That default is the trap this rule exists for.
      if (c.inForm && c.tag === "button" && c.type === "") return "a typeless button in a form submits it";
      return undefined;
    },
  },
  {
    rule: "authentication",
    check: (c) => {
      const term = matchedTerm(`${c.label} ${c.role}`, AUTH_TERMS, AUTH_TERMS_TH);
      return term === undefined ? undefined : `label contains authentication wording "${term}"`;
    },
  },
  {
    rule: "destructive-wording",
    check: (c) => {
      const term = matchedTerm(c.label, DESTRUCTIVE_TERMS, DESTRUCTIVE_TERMS_TH);
      return term === undefined ? undefined : `label contains destructive wording "${term}"`;
    },
  },
];

/**
 * Judge whether a candidate may be **activated**. Returns the first rule that stops it, with the
 * fact that tripped it; `undefined` means the click is allowed. Pure — it reads the candidate and
 * nothing else.
 */
export function refuse(candidate: Candidate): Refusal | undefined {
  for (const { rule, check } of RULES) {
    const detail = check(candidate);
    if (detail !== undefined) return { selector: candidate.selector, rule, detail };
  }
  return undefined;
}

function kindsFor(candidate: Candidate): ActionKind[] {
  const kinds: ActionKind[] = [];
  if (candidate.scrollable) kinds.push("scroll");
  if (candidate.listeners.some((type) => HOVER_EVENTS.has(type)) || candidate.pointerCursor) {
    kinds.push("hover");
  }
  if (candidate.focusable) kinds.push("focus");
  const activatable =
    candidate.listeners.some((type) => CLICK_EVENTS.has(type)) ||
    candidate.tag === "button" ||
    candidate.tag === "a" ||
    candidate.role === "button";
  if (activatable) kinds.push("click");
  return kinds;
}

/**
 * Turn candidates into a bounded, deterministic, ordered plan.
 *
 * Determinism comes from sorting on `order` and `selector` — never on array position, because
 * discovery's traversal order is not a property anyone has pinned. The bounds drop actions and
 * **count what they dropped**: a cap that truncates silently reads afterwards as "we covered
 * everything", which is the one thing the coverage vector must never be able to say falsely.
 */
export function planActions(candidates: Candidate[], limits: InteractionLimits): InteractionPlan {
  const refusals: Refusal[] = [];
  const byKind = new Map<ActionKind, PlannedAction[]>(KIND_ORDER.map((kind) => [kind, []]));

  const sorted = [...candidates].sort(
    (a, b) => a.order - b.order || a.selector.localeCompare(b.selector),
  );
  for (const candidate of sorted) {
    const refusal = refuse(candidate);
    if (refusal !== undefined) refusals.push(refusal);
    for (const kind of kindsFor(candidate)) {
      if (kind === "click" && refusal !== undefined) continue;
      byKind.get(kind)!.push({
        kind,
        selector: candidate.selector,
        order: candidate.order,
        tag: candidate.tag,
        label: candidate.label,
      });
    }
  }

  const truncated: Record<ActionKind, number> = { scroll: 0, hover: 0, focus: 0, click: 0 };
  const actions: PlannedAction[] = [];
  for (const kind of KIND_ORDER) {
    let kept = 0;
    for (const action of byKind.get(kind)!) {
      if (kept >= limits.perKind || actions.length >= limits.total) truncated[kind] += 1;
      else {
        actions.push(action);
        kept += 1;
      }
    }
  }

  return {
    schemaVersion: INTERACTION_SCHEMA_VERSION,
    discovered: candidates.length,
    actions,
    refusals,
    truncated,
  };
}

/**
 * What the driver reads back about a selector immediately before acting on it: every fact `refuse`
 * judges, so the policy can be re-run rather than approximated by comparing one string.
 */
export interface ObservedElement {
  found: boolean;
  tag: string;
  role: string;
  label: string;
  type: string;
  href: string;
  target: string;
  download: boolean;
  inForm: boolean;
  sameOrigin: boolean;
}

/**
 * Say why a planned action must not be performed, or "" when the element is still the one the
 * policy judged.
 *
 * A selector is a description of a position, and a page that keeps mounting content invalidates it.
 * Measured on `www.firecrawl.dev`: while a 32-action plan ran, the document grew by ~200 elements
 * and 28 of the 32 selectors no longer resolved — each burning a 2s actionability timeout. The same
 * mechanism is a safety problem, not only a coverage one: an insertion can leave a `:nth-child(1)`
 * path pointing at a *different* control, and the driver would then activate an element `refuse`
 * never saw.
 *
 * **The policy is re-run rather than the label compared.** Comparing labels was the first design and
 * it fails in both directions: `<button>Inbox (3)</button>` becoming `Inbox (4)` is an ordinary live
 * update, and skipping that click is a false alarm, while `Continue` becoming `Read more` passes a
 * string check on nothing. What actually matters is whether the element sitting there *now* is one
 * the policy would allow, and that is a question `refuse` already answers.
 *
 * Only `click` is re-judged. Hovering, focusing and scrolling cannot submit or navigate, so a page
 * that mutates its own text would otherwise have every hover reported stale for no reason.
 */
export function isStale(action: PlannedAction, observed: ObservedElement): string {
  if (!observed.found) return `element is gone: ${action.selector}`;
  if (observed.tag !== action.tag) return `tag changed from ${action.tag} to ${observed.tag}`;
  if (action.kind !== "click") return "";
  const refusal = refuse({
    ...observed,
    selector: action.selector,
    // The facts `refuse` does not read. They decide which *kinds* an element offers, which was
    // settled when the plan was made and is not what this check is about.
    listeners: [],
    scrollable: false,
    focusable: false,
    pointerCursor: false,
    order: action.order,
  });
  return refusal === undefined ? "" : `now refused: ${refusal.rule} — ${refusal.detail}`;
}

/** The in-page cap on discovered candidates. A page with 20,000 links must not produce 20,000 rows. */
export const DISCOVERY_CAP = 400;

/**
 * Read candidates from the page. Everything it reports is a structural fact — tag, role, label,
 * href, target, form ancestry, focusability, scrollability, computed cursor — because those are
 * what the policy is checked against, and a discovery step that guessed intent would move the
 * judgement out of the pure module where it can be tested.
 *
 * `listeners` is left empty here. The registrations the instrumentation layer intercepts are
 * recorded per event type, not per element, so there is nothing yet to attribute to a selector;
 * the field exists so the policy and its tests already work in the terms that layer will supply.
 *
 * A selector is emitted only when it resolves to exactly one element. Ambiguity is dropped rather
 * than guessed — a plan that acts on the wrong element is worse than a plan with one fewer action.
 */
export const DISCOVERY_SCRIPT = `(() => {
  const cap = ${DISCOVERY_CAP};
  const resolvesToOne = (selector) => {
    try { return document.querySelectorAll(selector).length === 1; } catch (error) { return false; }
  };
  // A path is anchored at the nearest ancestor carrying a unique id, and only falls back to a path
  // from <html> when there is none. The fallback is the fragile one: measured on www.firecrawl.dev,
  // a page that mounts ~200 more elements while the plan runs invalidated 28 of 32 selectors, all
  // of them full-depth "html > ... > main:nth-child(151) > ..." paths that any insertion shifts.
  const selectorFor = (element) => {
    if (element.id && resolvesToOne("#" + CSS.escape(element.id))) return "#" + CSS.escape(element.id);
    const chain = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      const parent = current.parentElement;
      if (!parent) break;
      const index = Array.prototype.indexOf.call(parent.children, current) + 1;
      chain.unshift(current.tagName.toLowerCase() + ":nth-child(" + index + ")");
      if (parent.id) {
        const anchored = "#" + CSS.escape(parent.id) + " > " + chain.join(" > ");
        if (resolvesToOne(anchored)) return anchored;
      }
      // A path rooted at <html> can only resolve once the chain reaches a direct child of it, so
      // testing it at every level costs one querySelectorAll per ancestor and can never succeed.
      if (parent === document.documentElement) {
        const rooted = "html > " + chain.join(" > ");
        if (resolvesToOne(rooted)) return rooted;
      }
      current = parent;
    }
    return "";
  };
  const visible = (element) => {
    if (element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    // A fully transparent control still takes a click, and a page that puts one over the viewport
    // would have the driver press something no human could see.
    return style.opacity !== "0";
  };
  const scrolls = (element, style) => {
    const overflow = style.overflow + " " + style.overflowX + " " + style.overflowY;
    if (!/auto|scroll/.test(overflow)) return false;
    return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
  };
  const focusables = "a[href], button, input, select, textarea, [tabindex]";
  // A control the page has declared unavailable is not an interaction target, however it says so.
  // \`aria-disabled\` is the form a component library usually uses, because it keeps the element
  // focusable for screen readers — and it is invisible to a check that reads only \`disabled\`.
  const unavailable = (element) =>
    element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
  const takesFocus = (element) => {
    if (unavailable(element)) return false;
    const tabindex = element.getAttribute("tabindex");
    if (tabindex !== null) return Number(tabindex) >= 0;
    return element.matches(focusables);
  };
  const sameOrigin = (element) => {
    const href = element.getAttribute("href") || element.getAttribute("action") || "";
    if (href === "") return true;
    try { return new URL(href, location.href).origin === location.origin; } catch (error) { return false; }
  };
  // Everything the element says, joined — not the first source that is non-empty.
  //
  // An icon button carries its meaning in \`title\` and has no text at all, so reading text alone
  // hands \`refuse\` an empty string and every wording rule passes. But *preferring* the attribute
  // is worse: \`<button title="Open panel">Delete account</button>\` would then be judged on
  // "Open panel" and clicked. A wording rule should see whatever the element says, wherever it
  // says it, so the sources are concatenated and none of them can mask another.
  //
  // \`observeElement\` in interaction-drive.ts must compute this identically.
  const labelOf = (element) =>
    [
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || "",
      element.innerText || ""
    ].join(" ").replace(/\\s+/g, " ").trim().slice(0, 120);
  const structural = focusables + ", [role], [onclick], form, [class*=btn], [class*=button]";
  const out = [];
  const cursors = new Map();
  let order = 0;
  // One pass, one getComputedStyle per element: the style is needed for the cursor and the
  // scroll test alike, and a page with a few thousand nodes pays this twice if they are split.
  for (const element of document.querySelectorAll("*")) {
    // One element must not cost the whole run. A custom element may define a getter that throws,
    // and an exception here rejects the evaluate before any candidate is returned.
    try {
    const style = getComputedStyle(element);
    cursors.set(element, style.cursor);
    const scrollable = scrolls(element, style);
    // \`cursor\` is an inherited property, so one styled button reports a pointer cursor on every
    // descendant — including the <g> and <path> inside its icon, which are the same target as the
    // anchor and are not hoverable in their own right. Measured on www.firecrawl.dev: 10 of 32
    // actions timed out on SVG interior nodes. Only the top of a pointer-cursor subtree counts.
    const parent = element.parentElement;
    const inherited = parent !== null && cursors.get(parent) === "pointer";
    const pointerCursor = style.cursor === "pointer" && !inherited;
    if (!scrollable && !pointerCursor && !element.matches(structural)) continue;
    order += 1;
    if (out.length >= cap) break;
    if (unavailable(element)) continue;
    if (!visible(element)) continue;
    const selector = selectorFor(element);
    if (selector === "") continue;
    out.push({
      selector: selector,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      label: labelOf(element),
      type: (element.getAttribute("type") || "").toLowerCase(),
      href: element.getAttribute("href") || "",
      target: element.getAttribute("target") || "",
      download: element.hasAttribute("download"),
      // \`element.form\` covers the \`form="id"\` attribute, which associates a control with a form
      // it is not inside. An icon button written that way submits while \`closest("form")\` is null.
      inForm: element.form instanceof HTMLFormElement || element.closest("form") !== null,
      sameOrigin: sameOrigin(element),
      listeners: [],
      scrollable: scrollable,
      focusable: takesFocus(element),
      pointerCursor: pointerCursor,
      order: order
    });
    } catch (error) { continue; }
  }
  return out;
})()`;

function isCandidate(value: unknown): value is Candidate {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  for (const key of ["selector", "tag", "role", "label", "type", "href", "target"]) {
    if (typeof record[key] !== "string") return false;
  }
  for (const key of ["download", "inForm", "sameOrigin", "scrollable", "focusable", "pointerCursor"]) {
    if (typeof record[key] !== "boolean") return false;
  }
  if (typeof record.order !== "number" || !Number.isFinite(record.order)) return false;
  if (!Array.isArray(record.listeners)) return false;
  return record.listeners.every((type) => typeof type === "string");
}

/**
 * Read what the discovery script returned. A malformed row is dropped rather than thrown on: the
 * page may have navigated mid-evaluation, and losing one candidate is not worth losing the run.
 * The count of what survived is `plan.discovered`, so a drop is visible rather than assumed away.
 */
export function discoveredCandidates(value: unknown): Candidate[] {
  return Array.isArray(value) ? value.filter(isCandidate) : [];
}
