import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = (require("playwright/package.json") as { version: string }).version;
const FONT_FACE_LIMIT = 256;

export interface ReplayContext {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  locale: string;
  timezoneId: string;
  reducedMotion: "reduce" | "no-preference";
  colorScheme: "light" | "dark" | "no-preference";
  userAgent: string;
}

export interface StorageAllowlist {
  localStorage?: readonly string[];
  sessionStorage?: readonly string[];
}

interface WebStorageReader {
  items(): Promise<Array<{ name: string; value: string }>>;
}

export interface EnvironmentPage {
  localStorage: WebStorageReader;
  sessionStorage: WebStorageReader;
  evaluate<Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
}

interface ObservedEnvironment {
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;
  locales: string[];
  timezoneId: string;
  reducedMotion: "reduce" | "no-preference";
  colorScheme: "light" | "dark" | "no-preference";
  userAgent: string;
  userAgentData?: {
    brands: Array<{ brand: string; version: string }>;
    mobile: boolean;
    platform: string;
  };
  browser: {
    name: "chromium";
    version: string;
    playwrightVersion: string;
    channel?: string;
  };
  fontFaces: {
    entries: Array<{
      family: string;
      style: string;
      weight: string;
      stretch: string;
      status: string;
    }>;
    truncated: boolean;
  };
}

/**
 * Every distinct origin the navigation passed through, oldest hop first (#157).
 *
 * Checking only where the page **ended up** is not enough: a chain that goes public → link-local →
 * public satisfies a final-origin check while the middle hop's request and response are already
 * recorded in the HAR. The refusal this project used to carry — abort whenever the final origin
 * differs — happened to bound that case, and replacing it with an address check on one origin
 * would have quietly given the bound away.
 *
 * Duck-typed rather than requiring Playwright's `Response`, because a fake browser's `goto`
 * returns nothing and the structural interface types it `unknown`. A navigation this cannot read
 * yields an empty list; the caller's final-origin check still runs, so that is a gap in what the
 * fakes exercise rather than a hole in what production enforces.
 */
export function originsInRedirectChain(navigation: unknown): string[] {
  const request = (navigation as { request?: () => unknown } | undefined)?.request?.();
  const origins: string[] = [];
  const seenRequests = new Set<unknown>();
  let hop: unknown = request;
  while (hop !== undefined && hop !== null && !seenRequests.has(hop)) {
    seenRequests.add(hop);
    const url = (hop as { url?: () => unknown }).url?.();
    if (typeof url === "string") {
      try {
        const { origin } = new URL(url);
        if (!origins.includes(origin)) origins.unshift(origin);
      } catch {
        // A URL this cannot parse names no origin to check. Skipping it is right: the policy
        // applies to origins, and an unparseable hop is reported by the navigation itself.
      }
    }
    hop = (hop as { redirectedFrom?: () => unknown }).redirectedFrom?.();
  }
  return origins;
}

/**
 * Apply the caller's network policy to every origin the navigation touched that is not the one it
 * was asked for (#157).
 *
 * **Default-deny.** With no policy supplied this refuses, which is exactly what `captureHar` did
 * before #157 — it aborted any capture whose origin changed. A library caller that never opted
 * into a policy keeps that behaviour instead of silently losing it, and `capture_page` opts in by
 * passing the same address check it already runs pre-flight.
 */
export async function assertOriginsAllowed(
  origins: readonly string[],
  primaryOrigin: string,
  assertOriginAllowed: ((origin: string) => Promise<void>) | undefined,
): Promise<void> {
  for (const origin of origins) {
    if (origin === primaryOrigin) continue;
    if (assertOriginAllowed === undefined) {
      throw new Error(
        `capture refused a redirect to ${origin}: the requested origin was ${primaryOrigin} and no network policy was supplied for another one`,
      );
    }
    await assertOriginAllowed(origin);
  }
}

export interface EnvironmentV1 {
  schemaVersion: 1;
  /** The origin of the URL capture was asked for. The storage allowlist is written for this one. */
  primaryOrigin: string;
  /**
   * The origin the page actually ended up on (#157). Equal to `primaryOrigin` unless the page
   * redirected; when it differs, `replay.storage` is empty because those entries belong to this
   * origin and not to the one the allowlist governs.
   */
  finalOrigin: string;
  capture: {
    requested: Partial<ReplayContext>;
    observed: ObservedEnvironment;
  };
  replay: {
    context: ReplayContext;
    requiredBrowser: ObservedEnvironment["browser"];
    storage: {
      origin: string;
      allowlist: { localStorage: string[]; sessionStorage: string[] };
      localStorage: Array<{ name: string; value: string }>;
      sessionStorage: Array<{ name: string; value: string }>;
    };
  };
  omissions: {
    storage: {
      policy: "explicit-allowlist";
      omittedLocalStorageEntries: number;
      omittedSessionStorageEntries: number;
      indexedDB: "not-collected";
      cacheStorage: "not-collected";
      cookies: "not-restored";
      crossOriginStorage: "not-collected";
    };
    fonts: "declared-faces-only; host-font availability and text metrics not captured";
  };
}

function normalizedAllowlist(values: readonly string[] | undefined, label: string): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    throw new Error(`${label} allowlist must contain only strings`);
  }
  const unique = new Set<string>();
  for (const value of values) {
    if (unique.has(value)) throw new Error(`${label} allowlist contains duplicate key: ${value}`);
    unique.add(value);
  }
  return [...unique].sort();
}

function allowedEntries(
  entries: Array<{ name: string; value: string }>,
  allowlist: readonly string[],
): Array<{ name: string; value: string }> {
  const allowed = new Set(allowlist);
  return entries.filter(({ name }) => allowed.has(name)).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function collectEnvironment(options: {
  page: EnvironmentPage;
  url: string;
  browserVersion: string;
  browserChannel?: string;
  requested?: Partial<ReplayContext>;
  storageAllowlist?: StorageAllowlist;
  /**
   * Decide whether an origin other than the requested one may be captured (#157). Injected rather
   * than imported because the policy belongs to whoever owns the network position — the tool —
   * and `captureHar` deliberately does not decide it. **Absent means refuse**, see
   * `assertOriginsAllowed`.
   */
  assertOriginAllowed?: (origin: string) => Promise<void>;
}): Promise<EnvironmentV1> {
  const primaryOrigin = new URL(options.url).origin;
  const requested = { ...options.requested };
  const allowlist = {
    localStorage: normalizedAllowlist(
      options.storageAllowlist?.localStorage,
      "localStorage",
    ),
    sessionStorage: normalizedAllowlist(
      options.storageAllowlist?.sessionStorage,
      "sessionStorage",
    ),
  };

  const { origin: finalOrigin, ...observedPage } = await options.page.evaluate(() => {
    type UserAgentData = {
      toJSON(): {
        brands: Array<{ brand: string; version: string }>;
        mobile: boolean;
        platform: string;
      };
    };
    const userAgentData = (navigator as Navigator & { userAgentData?: UserAgentData })
      .userAgentData?.toJSON();
    type ObservedFontFace = {
      family: string;
      style: string;
      weight: string;
      stretch: string;
      status: string;
    };
    const compareFontFaces = (left: ObservedFontFace, right: ObservedFontFace): number => {
      const leftFields = [left.family, left.style, left.weight, left.stretch, left.status];
      const rightFields = [right.family, right.style, right.weight, right.stretch, right.status];
      for (let index = 0; index < leftFields.length; index += 1) {
        if (leftFields[index]! < rightFields[index]!) return -1;
        if (leftFields[index]! > rightFields[index]!) return 1;
      }
      return 0;
    };
    const fontFaces: ObservedFontFace[] = [];
    for (const face of document.fonts) {
      const observedFace = {
        family: face.family,
        style: face.style,
        weight: face.weight,
        stretch: face.stretch,
        status: face.status,
      };
      if (fontFaces.some((candidate) => compareFontFaces(candidate, observedFace) === 0)) continue;
      if (fontFaces.length < 257) {
        fontFaces.push(observedFace);
        fontFaces.sort(compareFontFaces);
      } else if (compareFontFaces(observedFace, fontFaces[256]!) < 0) {
        fontFaces[256] = observedFace;
        fontFaces.sort(compareFontFaces);
      }
    }
    const colorScheme = matchMedia("(prefers-color-scheme: dark)").matches
      ? ("dark" as const)
      : matchMedia("(prefers-color-scheme: light)").matches
        ? ("light" as const)
        : ("no-preference" as const);

    return {
      origin: location.origin,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      locale: navigator.language,
      locales: [...navigator.languages],
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? ("reduce" as const)
        : ("no-preference" as const),
      colorScheme,
      userAgent: navigator.userAgent,
      ...(userAgentData ? { userAgentData } : {}),
      fontFaces: { entries: fontFaces.slice(0, 256), truncated: fontFaces.length > 256 },
    };
  });

  const fontFaces = observedPage.fontFaces.entries.slice(0, FONT_FACE_LIMIT);
  // §6.2 + #157. Storage is read from the page **after** navigation, so if the page ended up on a
  // different origin those entries belong to that origin and the allowlist — written for the
  // requested one — does not govern them. Skip the read, exactly as the opaque-origin branch
  // already does; both origins are published so a reader can see it happened.
  //
  // Refusing the whole capture is what this replaces. That was far wider than the risk it named:
  // an apex domain redirecting to `www` is one of the most common configurations on the web, and
  // it made `https://firecrawl.dev/` and `https://chaingpt.org/` unarchivable. Nothing else in the
  // archive is scoped to the requested origin — the HAR records the URLs it saw, the DOM is the
  // DOM that rendered, the animation inventory describes the page that ran.
  // The caller's network policy applies to where the page **landed**, not only to where it was
  // asked to go (#157). Before this, `capture-guards.ts` could say its pre-flight address check
  // "cannot by itself stop a redirect into a private network. It does not need to: a redirect to
  // a different host is cross-origin, and `collectEnvironment` refuses to publish" — the two were
  // a documented pair. Removing that refusal without this hook would leave a public URL that
  // redirects to `169.254.169.254` publishing the internal page instead of throwing it away.
  await assertOriginsAllowed([finalOrigin], primaryOrigin, options.assertOriginAllowed);
  const storageIsThisOrigin = primaryOrigin !== "null" && finalOrigin === primaryOrigin;
  const [allLocalStorage, allSessionStorage] = storageIsThisOrigin
    ? await Promise.all([
        options.page.localStorage.items(),
        options.page.sessionStorage.items(),
      ])
    : [[], []];
  const localStorage = allowedEntries(allLocalStorage, allowlist.localStorage);
  const sessionStorage = allowedEntries(allSessionStorage, allowlist.sessionStorage);
  const browser = {
    name: "chromium" as const,
    version: options.browserVersion,
    playwrightVersion: PLAYWRIGHT_VERSION,
    ...(options.browserChannel ? { channel: options.browserChannel } : {}),
  };
  const observed: ObservedEnvironment = {
    ...observedPage,
    browser,
    fontFaces: {
      entries: fontFaces,
      truncated: observedPage.fontFaces.truncated,
    },
  };
  const replayContext: ReplayContext = {
    viewport: requested.viewport ?? observed.viewport,
    deviceScaleFactor: requested.deviceScaleFactor ?? observed.devicePixelRatio,
    locale: requested.locale ?? observed.locale,
    timezoneId: requested.timezoneId ?? observed.timezoneId,
    reducedMotion: requested.reducedMotion ?? observed.reducedMotion,
    colorScheme: requested.colorScheme ?? observed.colorScheme,
    userAgent: requested.userAgent ?? observed.userAgent,
  };

  return {
    schemaVersion: 1,
    primaryOrigin,
    finalOrigin,
    capture: { requested, observed },
    replay: {
      context: replayContext,
      requiredBrowser: browser,
      storage: { origin: primaryOrigin, allowlist, localStorage, sessionStorage },
    },
    omissions: {
      storage: {
        policy: "explicit-allowlist",
        omittedLocalStorageEntries: allLocalStorage.length - localStorage.length,
        omittedSessionStorageEntries: allSessionStorage.length - sessionStorage.length,
        indexedDB: "not-collected",
        cacheStorage: "not-collected",
        cookies: "not-restored",
        crossOriginStorage: "not-collected",
      },
      fonts: "declared-faces-only; host-font availability and text metrics not captured",
    },
  };
}
