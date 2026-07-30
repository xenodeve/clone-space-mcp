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
  const FRAME_KEY = "0";
  let sequence = 0;
  const ids = new WeakMap();

  function assign(el) {
    if (ids.has(el)) return ids.get(el);
    const id = "wa:" + FRAME_KEY + ":" + (sequence++);
    ids.set(el, id);
    return id;
  }

  /** Deterministic preorder: the same DOM produces the same sequence twice. */
  function walk(root) {
    const out = [];
    const visit = (el, parentId) => {
      const id = assign(el);
      out.push({ el, id, parentId });
      for (const child of el.children) visit(child, id);
    };
    visit(root, null);
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

  /** Attributes stable across runs. Anything a framework rewrites on hydration stays out. */
  const STABLE_ATTRS = ["data-fixture-id", "data-identity-case", "data-testid", "role", "name", "type"];

  function fingerprint(entry) {
    const el = entry.el;
    const attrs = {};
    for (const a of STABLE_ATTRS) {
      const v = el.getAttribute(a);
      if (v !== null) attrs[a] = v;
    }
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
      textHash: text === "" ? null : text,
      parentId: entry.parentId,
    };
  }

  window.${IDENTITY_GLOBAL} = {
    snapshot() {
      return { elements: walk(document.documentElement).map(fingerprint) };
    },
  };
})();
`;

/** Structural, so `src/` never imports playwright — the build targets Bun (ADR 0001). */
export interface InjectablePage {
  // Return types are `unknown` on purpose: Playwright's `addInitScript` resolves to a
  // Disposable, and narrowing to void here made a real Page fail to satisfy this.
  addInitScript(script: string): Promise<unknown>;
  goto(url: string, options?: { waitUntil?: "load" }): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
}

/**
 * Injects, navigates, and reads the snapshot back — the shape capture and replay will both
 * call. Injection happens before navigation because `addInitScript` only applies to
 * documents created after it is registered.
 */
export async function captureIdentity(
  page: InjectablePage,
  url: string,
): Promise<IdentitySnapshot> {
  await page.addInitScript(IDENTITY_INIT_SCRIPT);
  await page.goto(url, { waitUntil: "load" });

  const { elements } = await page.evaluate<{ elements: ElementFingerprint[] }>(
    `window.${IDENTITY_GLOBAL}.snapshot()`,
  );

  return { schemaVersion: IDENTITY_SCHEMA_VERSION, elements };
}
