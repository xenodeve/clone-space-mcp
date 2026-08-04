import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureHar } from "../../src/capture/record.ts";

function fakeCdpSession(loaderId: string) {
  return async () => ({ send: async () => ({ frameTree: { frame: { loaderId } } }) });
}

function fakeChangingCdpSession() {
  const loaderIds = [
    "11112222333344445555666677778888",
    "9999AAAABBBBCCCCDDDDEEEEFFFF0000",
  ];
  let call = 0;
  return async () => ({
    send: async () => ({ frameTree: { frame: { loaderId: loaderIds[call++]! } } }),
  });
}

test("captureHar configures and drives a browser context", async () => {
  let contextOptions: unknown;
  let gotoCall: unknown;
  let contextClosed = false;
  let harPath: string | undefined;
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-unit-"));

  const context = {
    request: {
      async get() {},
    },
    newCDPSession: fakeCdpSession("A1B2C3D4E5F60718293A4B5C6D7E8F90"),
    async newPage() {
      let evaluation = 0;
      let pageUrl = "";
      return {
        localStorage: { async items() { return []; } },
        sessionStorage: { async items() { return []; } },
        async goto(url: string, options: { waitUntil: "load" }) {
          pageUrl = url;
          gotoCall = { url, options };
        },
        on() {},
        url() {
          return pageUrl;
        },
        async evaluate<Result>() {
          evaluation += 1;
          if (evaluation === 1) return undefined as Result;
          return {
            origin: "https://example.com",
            viewport: { width: 1280, height: 720 },
            devicePixelRatio: 1,
            locale: "en-US",
            locales: ["en-US"],
            timezoneId: "UTC",
            reducedMotion: "no-preference",
            colorScheme: "light",
            userAgent: "FixtureAgent/1.0",
            fontFaces: { entries: [], truncated: false },
          } as Result;
        },
      };
    },
    async close() {
      contextClosed = true;
      writeFileSync(harPath!, '{"log":{"entries":[]}}');
    },
  };

  const browser = {
    version() {
      return "Chromium/140.0.0.0";
    },
    async newContext(options: { recordHar: { path: string } }) {
      contextOptions = options;
      harPath = options.recordHar.path;
      return context;
    },
  };

  const url = "https://example.com";
  try {
    harPath = await captureHar({ browser, url, outDir });

    expect(harPath.endsWith("network.har")).toBe(true);
    expect(contextOptions).toEqual({
      recordHar: {
        path: expect.any(String),
        mode: "full",
        content: "attach",
      },
    });
    expect((contextOptions as { recordHar: { path: string } }).recordHar.path).not.toBe(harPath);
    expect(gotoCall).toEqual({ url, options: { waitUntil: "load" } });
    expect(contextClosed).toBe(true);
    expect(existsSync(join(outDir, "capabilities.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(outDir, "capabilities.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      flags: {
        serviceWorkerDependent: false,
        webSocketDependent: false,
        closedShadowRootPresent: false,
        sourcemapDeclared: false,
      },
    });
    expect(statSync(join(outDir, "capabilities.json")).mode & 0o600).toBe(0o600);
    expect(JSON.parse(readFileSync(join(outDir, "checkpoints.json"), "utf8")).capabilities).toEqual({
      path: "capabilities.json",
      scope: "run",
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar refuses to mix a new capture with existing archive files", async () => {
  const root = mkdtempSync(join(tmpdir(), "clone-space-record-existing-"));
  const outDir = join(root, "archive");
  const existing = join(outDir, "old-sidecar.txt");
  let browserCalled = false;
  mkdirSync(outDir);
  writeFileSync(existing, "EXISTING_SENTINEL");

  try {
    await expect(
      captureHar({
        browser: {
          version() {
            return "Chromium/140.0.0.0";
          },
          async newContext() {
            browserCalled = true;
            throw new Error("browser must not be called");
          },
        },
        url: "https://example.com",
        outDir,
      }),
    ).rejects.toThrow(/output directory must be empty/);
    expect(browserCalled).toBe(false);
    expect(readFileSync(existing, "utf8")).toBe("EXISTING_SENTINEL");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("captureHar rejects an invalid primary URL before opening the browser", async () => {
  const root = mkdtempSync(join(tmpdir(), "clone-space-record-invalid-origin-"));
  let browserCalled = false;

  try {
    await expect(
      captureHar({
        browser: {
          version() {
            return "Chromium/140.0.0.0";
          },
          async newContext() {
            browserCalled = true;
            return {
              request: { async get() {} },
              newCDPSession: fakeCdpSession("B2C3D4E5F60718293A4B5C6D7E8F901A"),
              async newPage() {
                throw new Error("browser must not be called");
              },
              async close() {},
            };
          },
        },
        url: "not a valid absolute URL",
        outDir: join(root, "archive"),
      }),
    ).rejects.toThrow(/cannot be parsed as a URL|Invalid URL/);
    expect(browserCalled).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("captureHar publishes environment.json v1 with distinct surfaces and empty default storage", async () => {
  let harPath: string | undefined;
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-env-"));
  const url = "https://example.com/page";

  const context = {
    request: {
      async get() {},
    },
    newCDPSession: fakeCdpSession("C3D4E5F60718293A4B5C6D7E8F901A2B"),
    async newPage() {
      let evaluation = 0;
      let pageUrl = "";
      return {
        localStorage: { async items() { return []; } },
        sessionStorage: { async items() { return []; } },
        async goto(url: string) {
          pageUrl = url;
        },
        on() {},
        url() {
          return pageUrl;
        },
        async evaluate<Result>() {
          evaluation += 1;
          if (evaluation === 1) return undefined as Result;
          return {
            origin: "https://example.com",
            viewport: { width: 1280, height: 720 },
            devicePixelRatio: 1,
            locale: "en-US",
            locales: ["en-US"],
            timezoneId: "UTC",
            reducedMotion: "no-preference",
            colorScheme: "light",
            userAgent: "FixtureAgent/1.0",
            fontFaces: { entries: [], truncated: false },
          } as Result;
        },
      };
    },
    async close() {
      writeFileSync(harPath!, '{"log":{"entries":[]}}');
    },
  };

  const browser = {
    version() {
      return "Chromium/140.0.0.0";
    },
    async newContext(options: { recordHar: { path: string } }) {
      harPath = options.recordHar.path;
      return context;
    },
  };

  try {
    await captureHar({ browser, url, outDir });

    const environment = JSON.parse(readFileSync(join(outDir, "environment.json"), "utf8"));

    expect(environment).toMatchObject({
      schemaVersion: 1,
      primaryOrigin: "https://example.com",
      capture: {
        requested: {},
        observed: {
          viewport: { width: 1280, height: 720 },
          devicePixelRatio: 1,
          locale: "en-US",
          locales: ["en-US"],
          timezoneId: "UTC",
          reducedMotion: "no-preference",
          colorScheme: "light",
          userAgent: "FixtureAgent/1.0",
          browser: {
            name: "chromium",
            version: "Chromium/140.0.0.0",
            playwrightVersion: "1.62.0",
          },
          fontFaces: { entries: [], truncated: false },
        },
      },
      replay: {
        context: {
          viewport: { width: 1280, height: 720 },
          deviceScaleFactor: 1,
          locale: "en-US",
          timezoneId: "UTC",
          reducedMotion: "no-preference",
          colorScheme: "light",
          userAgent: "FixtureAgent/1.0",
        },
        requiredBrowser: {
          name: "chromium",
          version: "Chromium/140.0.0.0",
          playwrightVersion: "1.62.0",
        },
      },
    });
    expect(environment.replay.storage).toEqual({
      origin: "https://example.com",
      allowlist: {
        localStorage: [],
        sessionStorage: [],
      },
      localStorage: [],
      sessionStorage: [],
    });
    expect(environment.omissions).toEqual({
      storage: {
        policy: "explicit-allowlist",
        omittedLocalStorageEntries: 0,
        omittedSessionStorageEntries: 0,
        indexedDB: "not-collected",
        cacheStorage: "not-collected",
        cookies: "not-restored",
        crossOriginStorage: "not-collected",
      },
      fonts: "declared-faces-only; host-font availability and text metrics not captured",
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar publishes only explicitly allowlisted primary-origin storage", async () => {
  let harPath: string | undefined;
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-storage-"));
  let evaluation = 0;
  const browser = {
    version() {
      return "Chromium/140.0.0.0";
    },
    async newContext(options: { recordHar: { path: string } }) {
      harPath = options.recordHar.path;
      return {
        request: { async get() {} },
        newCDPSession: fakeCdpSession("D4E5F60718293A4B5C6D7E8F901A2B3C"),
        async newPage() {
          let pageUrl = "";
          return {
            localStorage: {
              async items() {
                return [
                  { name: "theme", value: "dark" },
                  { name: "private-local-name", value: "PRIVATE_LOCAL_VALUE" },
                ];
              },
            },
            sessionStorage: {
              async items() {
                return [
                  { name: "panel", value: "open" },
                  { name: "private-session-name", value: "PRIVATE_SESSION_VALUE" },
                ];
              },
            },
            async goto(url: string) {
              pageUrl = url;
            },
            on() {},
            url() {
              return pageUrl;
            },
            async evaluate<Result>() {
              evaluation += 1;
              if (evaluation === 1) return undefined as Result;
              return {
                origin: "https://example.com",
                viewport: { width: 1280, height: 720 },
                devicePixelRatio: 1,
                locale: "en-US",
                locales: ["en-US"],
                timezoneId: "UTC",
                reducedMotion: "no-preference",
                colorScheme: "light",
                userAgent: "FixtureAgent/1.0",
                fontFaces: { entries: [], truncated: false },
              } as Result;
            },
          };
        },
        async close() {
          writeFileSync(harPath!, '{"log":{"entries":[]}}');
        },
      };
    },
  };

  try {
    await captureHar({
      browser,
      url: "https://example.com/page",
      outDir,
      storageAllowlist: {
        localStorage: ["theme"],
        sessionStorage: ["panel"],
      },
    });
    const text = readFileSync(join(outDir, "environment.json"), "utf8");
    const environment = JSON.parse(text);

    expect(environment.replay.storage).toEqual({
      origin: "https://example.com",
      allowlist: { localStorage: ["theme"], sessionStorage: ["panel"] },
      localStorage: [{ name: "theme", value: "dark" }],
      sessionStorage: [{ name: "panel", value: "open" }],
    });
    expect(environment.omissions.storage.omittedLocalStorageEntries).toBe(1);
    expect(environment.omissions.storage.omittedSessionStorageEntries).toBe(1);
    expect(text).not.toContain("private-local-name");
    expect(text).not.toContain("PRIVATE_LOCAL_VALUE");
    expect(text).not.toContain("private-session-name");
    expect(text).not.toContain("PRIVATE_SESSION_VALUE");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar rejects duplicate storage allowlist keys without publishing an archive", async () => {
  let harPath: string | undefined;
  const root = mkdtempSync(join(tmpdir(), "clone-space-record-duplicate-"));
  const outDir = join(root, "archive");
  let evaluation = 0;
  const browser = {
    version() {
      return "Chromium/140.0.0.0";
    },
    async newContext(options: { recordHar: { path: string } }) {
      harPath = options.recordHar.path;
      return {
        request: { async get() {} },
        newCDPSession: fakeCdpSession("E5F60718293A4B5C6D7E8F901A2B3C4D"),
        async newPage() {
          let pageUrl = "";
          return {
            localStorage: { async items() { return []; } },
            sessionStorage: { async items() { return []; } },
            async goto(url: string) {
              pageUrl = url;
            },
            on() {},
            url() {
              return pageUrl;
            },
            async evaluate<Result>() {
              evaluation += 1;
              if (evaluation === 1) return undefined as Result;
              return {
                origin: "https://example.com",
                viewport: { width: 1280, height: 720 },
                devicePixelRatio: 1,
                locale: "en-US",
                locales: ["en-US"],
                timezoneId: "UTC",
                reducedMotion: "no-preference",
                colorScheme: "light",
                userAgent: "FixtureAgent/1.0",
                fontFaces: { entries: [], truncated: false },
              } as Result;
            },
          };
        },
        async close() {
          writeFileSync(harPath!, '{"log":{"entries":[]}}');
        },
      };
    },
  };

  try {
    await expect(
      captureHar({
        browser,
        url: "https://example.com/page",
        outDir,
        storageAllowlist: { localStorage: ["theme", "theme"] },
      }),
    ).rejects.toThrow(/localStorage allowlist contains duplicate key: theme/);
    expect(() => readFileSync(join(outDir, "environment.json"), "utf8")).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("captureHar refuses to publish when the primary document changes while the checkpoint was open", async () => {
  let harPath: string | undefined;
  const root = mkdtempSync(join(tmpdir(), "clone-space-record-document-change-"));
  const outDir = join(root, "archive");
  let evaluation = 0;
  const browser = {
    version() {
      return "Chromium/140.0.0.0";
    },
    async newContext(options: { recordHar: { path: string } }) {
      harPath = options.recordHar.path;
      return {
        request: { async get() {} },
        newCDPSession: fakeChangingCdpSession(),
        async newPage() {
          let pageUrl = "";
          return {
            localStorage: { async items() { return []; } },
            sessionStorage: { async items() { return []; } },
            async goto(url: string) {
              pageUrl = url;
            },
            on() {},
            url() {
              return pageUrl;
            },
            async evaluate<Result>() {
              evaluation += 1;
              if (evaluation === 1) return undefined as Result;
              return {
                origin: "https://example.com",
                viewport: { width: 1280, height: 720 },
                devicePixelRatio: 1,
                locale: "en-US",
                locales: ["en-US"],
                timezoneId: "UTC",
                reducedMotion: "no-preference",
                colorScheme: "light",
                userAgent: "FixtureAgent/1.0",
                fontFaces: { entries: [], truncated: false },
              } as Result;
            },
          };
        },
        async close() {
          writeFileSync(harPath!, '{"log":{"entries":[]}}');
        },
      };
    },
  };

  try {
    await expect(
      captureHar({
        browser,
        url: "https://example.com/page",
        outDir,
      }),
    ).rejects.toThrow(/the primary document changed while the checkpoint was open/);
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("captureHar publishes the document epoch built from the CDP loaderId", async () => {
  let harPath: string | undefined;
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-document-epoch-"));
  let evaluation = 0;
  const browser = {
    version() {
      return "Chromium/140.0.0.0";
    },
    async newContext(options: { recordHar: { path: string } }) {
      harPath = options.recordHar.path;
      return {
        request: { async get() {} },
        newCDPSession: fakeCdpSession("0123456789ABCDEF0123456789ABCDEF"),
        async newPage() {
          let pageUrl = "";
          return {
            localStorage: { async items() { return []; } },
            sessionStorage: { async items() { return []; } },
            async goto(url: string) {
              pageUrl = url;
            },
            on() {},
            url() {
              return pageUrl;
            },
            async evaluate<Result>() {
              evaluation += 1;
              if (evaluation === 1) return undefined as Result;
              return {
                origin: "https://example.com",
                viewport: { width: 1280, height: 720 },
                devicePixelRatio: 1,
                locale: "en-US",
                locales: ["en-US"],
                timezoneId: "UTC",
                reducedMotion: "no-preference",
                colorScheme: "light",
                userAgent: "FixtureAgent/1.0",
                fontFaces: { entries: [], truncated: false },
              } as Result;
            },
          };
        },
        async close() {
          writeFileSync(harPath!, '{"log":{"entries":[]}}');
        },
      };
    },
  };

  try {
    await captureHar({
      browser,
      url: "https://example.com/page",
      outDir,
    });
    const checkpoints = JSON.parse(readFileSync(join(outDir, "checkpoints.json"), "utf8"));

    expect(checkpoints.checkpoints[0].primaryTarget.documentEpoch).toBe(
      "epoch:0123456789ABCDEF0123456789ABCDEF",
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar refuses to publish when a HAR attachment corrupts a staged sidecar", async () => {
  let harPath: string | undefined;
  const root = mkdtempSync(join(tmpdir(), "clone-space-record-incoherent-"));
  const outDir = join(root, "archive");
  let evaluation = 0;
  const browser = {
    version() {
      return "Chromium/140.0.0.0";
    },
    async newContext(options: { recordHar: { path: string } }) {
      harPath = options.recordHar.path;
      return {
        request: { async get() {} },
        newCDPSession: fakeCdpSession("F60718293A4B5C6D7E8F901A2B3C4D5E"),
        async newPage() {
          let pageUrl = "";
          return {
            localStorage: { async items() { return []; } },
            sessionStorage: { async items() { return []; } },
            async goto(url: string) {
              pageUrl = url;
            },
            on() {},
            url() {
              return pageUrl;
            },
            async evaluate<Result>() {
              evaluation += 1;
              if (evaluation === 1) return undefined as Result;
              return {
                origin: "https://example.com",
                viewport: { width: 1280, height: 720 },
                devicePixelRatio: 1,
                locale: "en-US",
                locales: ["en-US"],
                timezoneId: "UTC",
                reducedMotion: "no-preference",
                colorScheme: "light",
                userAgent: "FixtureAgent/1.0",
                fontFaces: { entries: [], truncated: false },
              } as Result;
            },
          };
        },
        async close() {
          writeFileSync(
            harPath!,
            JSON.stringify({
              log: {
                entries: [
                  {
                    _resourceType: "websocket",
                    request: { url: "wss://example.com/socket" },
                    response: { content: { _file: "environment.json" } },
                  },
                ],
              },
            }),
          );
        },
      };
    },
  };

  try {
    await expect(
      captureHar({
        browser,
        url: "https://example.com/page",
        outDir,
      }),
    ).rejects.toThrow(/staged archive failed checkpoint coherence validation/);
    expect(readdirSync(root)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
