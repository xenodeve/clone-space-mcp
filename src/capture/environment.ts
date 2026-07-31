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

export interface EnvironmentV1 {
  schemaVersion: 1;
  primaryOrigin: string;
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

  if (primaryOrigin !== "null" && finalOrigin !== primaryOrigin) {
    throw new Error(`capture refused cross-origin redirect: ${primaryOrigin} -> ${finalOrigin}`);
  }
  const fontFaces = observedPage.fontFaces.entries.slice(0, FONT_FACE_LIMIT);
  const [allLocalStorage, allSessionStorage] = primaryOrigin === "null"
    ? [[], []]
    : await Promise.all([
        options.page.localStorage.items(),
        options.page.sessionStorage.items(),
      ]);
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
