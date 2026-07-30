import type { ElementFingerprint, IdentitySnapshot } from "./reconcile.ts";
import { IDENTITY_SCHEMA_VERSION } from "./reconcile.ts";

/**
 * Assigns `wa:` ids inside the page, and reads them back out.
 *
 * The same source must run on capture and on every replay pass — not an equivalent script,
 * the same one — or the two runs drift by construction (ADR 0002, Decision 1). That is why
 * the script lives here as one exported string rather than being written inline at each
 * call site.
 *
 * The in-page surface is **public**, not internal: `window.__waIdentity.snapshot()` is
 * covered by tests directly as well as through `captureIdentity`, so renaming it is a
 * contract change rather than a refactor.
 */

/** The global the injected script installs. Public API — see the note above. */
export const IDENTITY_GLOBAL = "__waIdentity";

/**
 * Source passed to `addInitScript`. It must run **before any page script**, or elements
 * created during parsing are never seen.
 */
export const IDENTITY_INIT_SCRIPT = `
(() => {
  // Injecting twice must be harmless. Playwright's addInitScript ACCUMULATES — measured:
  // four registrations make the script run four times on the next navigation — so a caller
  // that captures twice from one page would otherwise install a second MutationObserver and
  // wrap attachShadow a second time, without bound. The output stayed correct, which is why
  // it would not have been noticed.
  if (window.${IDENTITY_GLOBAL}) return;

  let sequence = 0;
  const ids = new WeakMap();

  /**
   * A stable 32-bit hash of an element's direct text.
   *
   * The raw text is deliberately NOT kept. It made the field name a lie, and it put page
   * content — including the full source of any <style> element — into identity.json, an
   * artifact that is supposed to carry identity and nothing else. That collides head-on
   * with the redaction contract the archive owes.
   */
  function hashText(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  /** Attributes stable across runs. Anything a framework rewrites on hydration stays out. */
  const STABLE_ATTRS = ["data-fixture-id", "data-identity-case", "data-testid", "role", "name", "type", "part"];

  function stableAttrs(el) {
    const attrs = {};
    for (const a of STABLE_ATTRS) {
      const v = el.getAttribute(a);
      if (v !== null) attrs[a] = v;
    }
    return attrs;
  }

  /**
   * The frame's namespace, derived from the fingerprint of the element that owns it —
   * never from its position among siblings.
   *
   * ADR 0002 originally specified an occurrence index among same-URL siblings. That is the
   * same positional flaw as #20 one level up: reorder two <iframe> and their namespaces swap
   * silently, taking every id inside them with it. Deriving from the owning element's own
   * stable evidence means the frame is exactly as identifiable as that element is.
   *
   * window.frameElement is null for a cross-origin frame, which is the stated limit: an
   * out-of-process iframe is a separate CDP target and needs its own handling.
   *
   * (No backticks anywhere in this string — it is a template literal, so one closes it
   * early and the rest of the file is then parsed as TypeScript.)
   */
  function frameKey() {
    const owner = (() => { try { return window.frameElement; } catch { return null; } })();
    if (!owner) return "0";

    let parentKey = "0";
    try {
      parentKey = window.parent.${IDENTITY_GLOBAL} ? window.parent.${IDENTITY_GLOBAL}.frameKey : "0";
    } catch { parentKey = "?"; }

    const evidence = owner.tagName.toLowerCase() + "|" +
      Object.entries(stableAttrs(owner)).sort().map(([k, v]) => k + "=" + v).join(",");
    return parentKey + "/" + evidence;
  }

  const FRAME_KEY = frameKey();

  function assign(el) {
    if (ids.has(el)) return ids.get(el);
    const id = "wa:" + FRAME_KEY + ":" + (sequence++);
    ids.set(el, id);
    return id;
  }

  /**
   * Deterministic preorder: the same DOM produces the same sequence twice.
   *
   * Open shadow roots are entered through el.shadowRoot. Patching attachShadow is not
   * needed for that — an open root stays readable — so it is not done. A closed root is
   * unreachable either way, which is the stated limit.
   */
  function walk(root, rootParentId) {
    const out = [];
    const visit = (el, parentId) => {
      const id = assign(el);
      out.push({ el, id, parentId });
      for (const child of el.children) visit(child, id);
      if (el.shadowRoot) {
        for (const child of el.shadowRoot.children) visit(child, id);
      }
    };
    visit(root, rootParentId ?? null);
    return out;
  }

  function siblingOrdinal(el) {
    if (!el.parentElement) return 0;
    let n = 0;
    for (const sib of el.parentElement.children) {
      if (sib === el) return n;
      if (sib.tagName === el.tagName) n++;
    }
    return n;
  }

  function fingerprint(entry) {
    const el = entry.el;
    const attrs = stableAttrs(el);
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.nodeValue;
    }
    text = text.trim();
    return {
      id: entry.id,
      frameKey: FRAME_KEY,
      tag: el.tagName.toLowerCase(),
      attrs,
      siblingOrdinal: siblingOrdinal(el),
      textHash: text === "" ? null : hashText(text),
      parentId: entry.parentId,
    };
  }

  /**
   * Everything ever seen, by id. An element removed from the tree keeps its last known
   * fingerprint rather than disappearing: capture saw it, so replay has to be able to
   * account for it. Without this the archive's contents depend on which side of a timer
   * the snapshot lands on.
   */
  const seen = new Map();

  function record(el, parentId) {
    for (const entry of walk(el, parentId)) seen.set(entry.id, fingerprint(entry));
  }

  /**
   * A MutationObserver on document sees nodes added during parsing, which is why the
   * script has to be injected before any page script runs. It does NOT see inside a shadow
   * root, so attachShadow is patched to observe each new root — this is where that patch
   * earns its place, not in the walk, which reads an open root directly.
   */
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        record(node, r.target && ids.has(r.target) ? ids.get(r.target) : null);
      }
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  const nativeAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = nativeAttachShadow.call(this, init);
    if (init && init.mode === "open") {
      observer.observe(root, { childList: true, subtree: true });
    }
    return root;
  };

  window.${IDENTITY_GLOBAL} = {
    frameKey: FRAME_KEY,
    snapshot() {
      // Re-walk so anything still attached carries a current fingerprint, then return the
      // union with everything previously seen.
      if (document.documentElement) record(document.documentElement, null);
      return { elements: [...seen.values()] };
    },
  };
})();
`;

/** Structural, so `src/` never imports playwright — the build targets Bun (ADR 0001). */
export interface EvaluableFrame {
  evaluate<T>(expression: string): Promise<T>;
}

export interface InjectablePage extends EvaluableFrame {
  // Return types are `unknown` on purpose: Playwright's `addInitScript` resolves to a
  // Disposable, and narrowing to void here made a real Page fail to satisfy this.
  addInitScript(script: string): Promise<unknown>;
  goto(url: string, options?: { waitUntil?: "load" }): Promise<unknown>;
  /** Every frame, including the main one — the injected script runs in all of them. */
  frames(): EvaluableFrame[];
}

export interface CaptureOptions {
  /**
   * How long to wait after `load` before taking the snapshot.
   *
   * `load` fires before deferred work runs, so a snapshot taken there sees only the served
   * HTML — the dynamic half of the page is simply absent. That is not a stable snapshot, it
   * is an early one, and the difference matters: a determinism test can pass on it while
   * observing nothing that could have varied.
   *
   * This is the crude version of the snapshot epoch the archive contracts require
   * (`docs/superpowers/plans/…#6.3`); a fixed delay is not a settle signal.
   */
  settleMs?: number;
  /**
   * Read the snapshot from the page as it stands, without navigating.
   *
   * Only for observing a state the caller has just produced — navigating would discard it.
   */
  reuse?: boolean;
}

/**
 * Injects, navigates, and reads the snapshot back — the shape capture and replay will both
 * call. Injection happens before navigation because `addInitScript` only applies to
 * documents created after it is registered.
 */
export async function captureIdentity(
  page: InjectablePage,
  url: string,
  options: CaptureOptions = {},
): Promise<IdentitySnapshot> {
  if (!options.reuse) {
    await page.addInitScript(IDENTITY_INIT_SCRIPT);
    await page.goto(url, { waitUntil: "load" });
  }

  if (options.settleMs) {
    await page.evaluate<void>(`new Promise((r) => setTimeout(r, ${options.settleMs}))`);
  }

  // Every frame carries its own namespace, so the snapshot is the union across frames. A
  // frame the script never reached (cross-origin, or detached mid-read) contributes nothing
  // rather than failing the whole capture — its absence is what capability reporting is for.
  const elements: ElementFingerprint[] = [];
  for (const frame of page.frames()) {
    try {
      const part = await frame.evaluate<{ elements: ElementFingerprint[] } | null>(
        `window.${IDENTITY_GLOBAL} ? window.${IDENTITY_GLOBAL}.snapshot() : null`,
      );
      if (part) elements.push(...part.elements);
    } catch {
      // Frame went away between listing and reading. Nothing to record.
    }
  }

  return { schemaVersion: IDENTITY_SCHEMA_VERSION, elements };
}
