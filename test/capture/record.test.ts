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
import { dirname, join } from "node:path";
import { captureHar } from "../../src/capture/record.ts";
import { validateCommit } from "../../src/capture/commit.ts";
import type { CdpTargetPayload } from "../../src/capture/targets.ts";

function fakeCdpSession(loaderId: string) {
  return async () => ({
    send: async (method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { loaderId } } };
      if (method === "DOM.getDocument") return { root: {} };
      return {};
    },
    on() {},
  });
}

function fakeChangingCdpSession() {
  const loaderIds = [
    "11112222333344445555666677778888",
    "9999AAAABBBBCCCCDDDDEEEEFFFF0000",
  ];
  let call = 0;
  return async () => ({
    send: async (method: string) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { loaderId: loaderIds[call++]! } } };
      }
      if (method === "DOM.getDocument") return { root: {} };
      return {};
    },
    on() {},
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
          if (evaluation === 1) return SWEEP_EVALUATE_RESULT as Result;
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
    expect(JSON.parse(readFileSync(join(outDir, "request-normalization.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      query: { volatileKeys: [], keyMatch: "case-insensitive-exact" },
    });
    expect(statSync(join(outDir, "request-normalization.json")).mode & 0o600).toBe(0o600);
    expect(JSON.parse(readFileSync(join(outDir, "checkpoints.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      har: { path: "network.har", scope: "run" },
      capabilities: { path: "capabilities.json", scope: "run" },
      requestNormalization: { path: "request-normalization.json", scope: "run" },
      termination: { path: "termination.json", scope: "run" },
      targets: { path: "targets.json", scope: "run" },
      commit: { path: "commit.json", scope: "run" },
      checkpoints: [
        {
          checkpointId: "cp:0",
          primaryTarget: { documentEpoch: "epoch:A1B2C3D4E5F60718293A4B5C6D7E8F90" },
          openedAt: expect.any(Number),
          artifacts: [],
        },
      ],
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("publishes sourcemapDeclared as undetermined when a script body cannot be read", async () => {
  let harPath: string | undefined;
  let responseHandler:
    | ((response: {
        request(): { resourceType(): string };
        url(): string;
        text(): Promise<string>;
      }) => void)
    | undefined;
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-sourcemap-undetermined-"));
  const context = {
    request: { async get() {} },
    newCDPSession: fakeCdpSession("A1B2C3D4E5F60718293A4B5C6D7E8F90"),
    async newPage() {
      let pageUrl = "";
      return {
        localStorage: { async items() { return []; } },
        sessionStorage: { async items() { return []; } },
        async goto(url: string) {
          pageUrl = url;
          responseHandler?.({
            request: () => ({ resourceType: () => "script" }),
            url: () => "https://example.com/unreadable.js",
            text: async () => {
              throw new Error("response body unavailable");
            },
          });
        },
        on(
          _event: string,
          handler: (response: {
            request(): { resourceType(): string };
            url(): string;
            text(): Promise<string>;
          }) => void,
        ) {
          responseHandler = handler;
        },
        url() {
          return pageUrl;
        },
        async evaluate<Result>() {
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
    await captureHar({ browser, url: "https://example.com", outDir });
    const capabilities = JSON.parse(readFileSync(join(outDir, "capabilities.json"), "utf8"));

    expect(capabilities.flags.sourcemapDeclared).toBe("undetermined");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("publishes a sourcemap declaration whose URL cannot be resolved", async () => {
  let harPath: string | undefined;
  let responseHandler:
    | ((response: {
        request(): { resourceType(): string };
        url(): string;
        text(): Promise<string>;
      }) => void)
    | undefined;
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-invalid-sourcemap-url-"));
  const context = {
    request: { async get() {} },
    newCDPSession: fakeCdpSession("A1B2C3D4E5F60718293A4B5C6D7E8F90"),
    async newPage() {
      let pageUrl = "";
      return {
        localStorage: { async items() { return []; } },
        sessionStorage: { async items() { return []; } },
        async goto(url: string) {
          pageUrl = url;
          responseHandler?.({
            request: () => ({ resourceType: () => "script" }),
            url: () => "https://example.com/declared.js",
            text: async () => "//# sourceMappingURL=http://[",
          });
        },
        on(
          _event: string,
          handler: (response: {
            request(): { resourceType(): string };
            url(): string;
            text(): Promise<string>;
          }) => void,
        ) {
          responseHandler = handler;
        },
        url() {
          return pageUrl;
        },
        async evaluate<Result>() {
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
    await captureHar({ browser, url: "https://example.com", outDir });
    const capabilities = JSON.parse(readFileSync(join(outDir, "capabilities.json"), "utf8"));

    expect(capabilities.flags.sourcemapDeclared).toBe(true);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("ignores dependency events delivered after capabilities are observed", async () => {
  let harPath: string | undefined;
  let registrationHandler:
    | ((event: { registrations?: Array<{ scopeURL?: string; isDeleted?: boolean }> }) => void)
    | undefined;
  let lateRegistrationInspected = false;
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-observation-boundary-"));
  const context = {
    request: { async get() {} },
    async newCDPSession() {
      return {
        async send(method: string) {
          if (method === "Page.getFrameTree") {
            return { frameTree: { frame: { loaderId: "A1B2C3D4E5F60718293A4B5C6D7E8F90" } } };
          }
          if (method === "DOM.getDocument") return { root: {} };
          return {};
        },
        on(
          _event: string,
          handler: (event: {
            registrations?: Array<{ scopeURL?: string; isDeleted?: boolean }>;
          }) => void,
        ) {
          registrationHandler = handler;
        },
      };
    },
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
      registrationHandler?.({
        registrations: [
          {
            get scopeURL() {
              lateRegistrationInspected = true;
              return "https://example.com/late-worker/";
            },
          },
        ],
      });
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
    await captureHar({ browser, url: "https://example.com", outDir });
    const capabilities = JSON.parse(readFileSync(join(outDir, "capabilities.json"), "utf8"));

    expect(lateRegistrationInspected).toBe(false);
    expect(capabilities.flags.serviceWorkerDependent).toBe(false);
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
          if (evaluation === 1) return SWEEP_EVALUATE_RESULT as Result;
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
              if (evaluation === 1) return SWEEP_EVALUATE_RESULT as Result;
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
              if (evaluation === 1) return SWEEP_EVALUATE_RESULT as Result;
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
              if (evaluation === 1) return SWEEP_EVALUATE_RESULT as Result;
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
              if (evaluation === 1) return SWEEP_EVALUATE_RESULT as Result;
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
              if (evaluation === 1) return SWEEP_EVALUATE_RESULT as Result;
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

const ENV_EVALUATE_RESULT = {
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
} as const;

/** The sweep evaluate's return shape (first evaluate call). 2 checkpoints: below the
 * quiet-window threshold (3) so the default outcome is "complete", not "quiet-window". */
const SWEEP_EVALUATE_RESULT = {
  sweepCheckpoints: 2,
  scrolls: 4,
  wallClockMs: 1200,
  height: 2400,
  quietWindow: false,
} as const;

/**
 * A fake browser whose `close()` writes the given HAR, so tests can drive the producer-side
 * ambiguity check and the policy publication without launching Chromium.
 */
function makeHarFakeBrowser(har: unknown) {
  let harPath: string;
  const context = {
    request: { async get() {} },
    newCDPSession: fakeCdpSession("A1B2C3D4E5F60718293A4B5C6D7E8F90"),
    async newPage() {
      let pageUrl = "";
      let evaluation = 0;
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
          if (evaluation === 1) return SWEEP_EVALUATE_RESULT as Result;
          return ENV_EVALUATE_RESULT as Result;
        },
      };
    },
    async close() {
      writeFileSync(harPath, JSON.stringify(har));
    },
  };
  return {
    version() {
      return "Chromium/140.0.0.0";
    },
    async newContext(options: { recordHar: { path: string } }) {
      harPath = options.recordHar.path;
      return context;
    },
  };
}

test("captureHar publishes the canonical explicit volatile-key policy", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-policy-")), "archive");
  const outDir = root;
  try {
    await captureHar({
      browser: makeHarFakeBrowser({ log: { entries: [] } }),
      url: "https://example.com/page",
      outDir,
      volatileQueryKeys: ["_T", "Nonce", "ts"],
    });
    const policy = JSON.parse(readFileSync(join(outDir, "request-normalization.json"), "utf8"));
    expect(policy.query.volatileKeys).toEqual(["_t", "nonce", "ts"]);
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

test("captureHar refuses when the policy collapses two distinct archived requests", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-ambiguous-")), "archive");
  const outDir = root;
  try {
    await expect(
      captureHar({
        browser: makeHarFakeBrowser({
          log: {
            entries: [
              { request: { url: "https://example.com/dup?_t=aaa", method: "GET" } },
              { request: { url: "https://example.com/dup?_t=bbb", method: "GET" } },
            ],
          },
        }),
        url: "https://example.com/page",
        outDir,
        volatileQueryKeys: ["_t"],
      }),
    ).rejects.toThrow(/collapses \d+ distinct archived request/);
    expect(readdirSync(dirname(root))).toEqual([]);
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

test("captureHar refuses duplicate volatile keys before opening the browser", async () => {
  let browserCalled = false;
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-dup-keys-")), "archive");
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
        url: "https://example.com/page",
        outDir: root,
        volatileQueryKeys: ["_t", "_T"],
      }),
    ).rejects.toThrow(/duplicate volatile query key: _t/);
    expect(browserCalled).toBe(false);
    expect(readdirSync(dirname(root))).toEqual([]);
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

test("captureHar refuses an empty volatile key before opening the browser", async () => {
  let browserCalled = false;
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-empty-key-")), "archive");
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
        url: "https://example.com/page",
        outDir: root,
        volatileQueryKeys: [""],
      }),
    ).rejects.toThrow(/empty volatile query key/);
    expect(browserCalled).toBe(false);
    expect(readdirSync(dirname(root))).toEqual([]);
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

test("captureHar accepts one distinct raw URL per normalized group", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-accept-")), "archive");
  const outDir = root;
  try {
    await captureHar({
      browser: makeHarFakeBrowser({
        log: {
          entries: [
            { request: { url: "https://example.com/api?_t=111&a=1", method: "GET" } },
            { request: { url: "https://example.com/static/app.js", method: "GET" } },
          ],
        },
      }),
      url: "https://example.com/page",
      outDir,
      volatileQueryKeys: ["_t"],
    });
    expect(existsSync(join(outDir, "request-normalization.json"))).toBe(true);
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

test("captureHar leaves network.har bytes unchanged by policy publication", async () => {
  const har = { log: { entries: [] } };
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-har-bytes-")), "archive");
  const outDir = root;
  try {
    await captureHar({
      browser: makeHarFakeBrowser(har),
      url: "https://example.com/page",
      outDir,
      volatileQueryKeys: ["_t"],
    });
    const published = JSON.parse(readFileSync(join(outDir, "network.har"), "utf8"));
    expect(published).toEqual(har);
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

test("captureHar publishes a commit marker that verifies the archive bytes", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-commit-")), "archive");
  const outDir = root;
  try {
    await captureHar({
      browser: makeHarFakeBrowser({ log: { entries: [] } }),
      url: "https://example.com/page",
      outDir,
    });
    const commitDoc = JSON.parse(readFileSync(join(outDir, "commit.json"), "utf8"));
    const result = await validateCommit(commitDoc, outDir);
    expect(result).toEqual({ ok: true });
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

test("a tampered published artifact is detected by the commit validator", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-tamper-")), "archive");
  const outDir = root;
  try {
    await captureHar({
      browser: makeHarFakeBrowser({ log: { entries: [] } }),
      url: "https://example.com/page",
      outDir,
    });
    const commitDoc = JSON.parse(readFileSync(join(outDir, "commit.json"), "utf8"));
    // Mutate the environment artifact after commit.
    const envPath = join(outDir, "environment.json");
    const original = readFileSync(envPath, "utf8");
    writeFileSync(envPath, original + "\n// tampered");
    const result = await validateCommit(commitDoc, outDir);
    expect(result).toEqual({ ok: false });
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

test("captureHar publishes termination.json recording why capture stopped", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-termination-")), "archive");
  const outDir = root;
  try {
    await captureHar({
      browser: makeHarFakeBrowser({ log: { entries: [] } }),
      url: "https://example.com/page",
      outDir,
    });
    const termination = JSON.parse(readFileSync(join(outDir, "termination.json"), "utf8"));
    expect(termination.schemaVersion).toBe(1);
    expect(termination.outcome).toBe("complete");
    expect(termination.stats).toMatchObject({
      sweepCheckpoints: 2,
      scrolls: 4,
      wallClockMs: 1200,
      height: 2400,
    });
    expect(termination.budgets.wallClockMs).toBeGreaterThan(0);
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

test("captureHar records budget-exceeded when the wall-clock cap is crossed", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "clone-space-record-termination-budget-")), "archive");
  const outDir = root;
  try {
    await captureHar({
      browser: makeHarFakeBrowser({ log: { entries: [] } }),
      url: "https://example.com/page",
      outDir,
      budgets: { wallClockMs: 100 },
    });
    const termination = JSON.parse(readFileSync(join(outDir, "termination.json"), "utf8"));
    expect(termination.outcome).toBe("incomplete");
    expect(termination.reason).toBe("budget-exceeded");
  } finally {
    rmSync(dirname(root), { recursive: true, force: true });
  }
});

/**
 * A browser-level CDP session (§6.9). Chromium emits `Target.targetCreated` for targets that
 * already exist the moment discovery is switched on, so the fake does the same: enabling
 * discovery replays the scripted events through whatever handlers were registered.
 */
function fakeBrowserCdpSession(
  events: readonly { method: string; payload: unknown }[],
  snapshot: readonly CdpTargetPayload[] = [],
  duringSnapshot: readonly { method: string; payload: unknown }[] = [],
) {
  const handlers = new Map<string, (payload: unknown) => void>();
  const sent: string[] = [];
  return {
    sent,
    emit(method: string, payload: unknown) {
      handlers.get(method)?.(payload);
    },
    open: async () => ({
      async send(method: string) {
        sent.push(method);
        if (method === "Target.setDiscoverTargets") {
          for (const event of events) handlers.get(event.method)?.(event.payload);
        }
        if (method === "Target.getTargets") {
          // Chromium enumerates its targets, then the response travels back. Anything created in
          // that window is reported by an event but is not in the snapshot that was already built.
          for (const event of duringSnapshot) handlers.get(event.method)?.(event.payload);
          return { targetInfos: snapshot };
        }
        return {};
      },
      on(method: string, handler: (payload: unknown) => void) {
        handlers.set(method, handler);
      },
    }),
  };
}

// Chromium keeps reporting targets while the context tears down. This wraps a fake browser so a
// chosen event arrives during `context.close()` — after `observingDependencies` has been cleared
// and before the inventory is serialized.
function browserEmittingDuringClose(
  session: ReturnType<typeof fakeBrowserCdpSession>,
  event: { method: string; payload: unknown },
) {
  const base = makeHarFakeBrowser({ log: { entries: [] } });
  return {
    ...base,
    newBrowserCDPSession: session.open,
    async newContext(options: { recordHar: { path: string } }) {
      const context = await base.newContext(options);
      return {
        ...context,
        async close() {
          session.emit(event.method, event.payload);
          await context.close();
        },
      };
    },
  };
}

test("captureHar publishes the targets discovered over the browser-level CDP session", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-targets-"));
  const session = fakeBrowserCdpSession([
    // The opener first, as Chromium reports it. `validateTargets` refuses a dangling openerId, so
    // an inventory that named a parent it never recorded would fail publication — loudly, rather
    // than by quietly dropping the relationship.
    {
      method: "Target.targetCreated",
      payload: { targetInfo: { targetId: "PAGE-0", type: "page", url: "https://example.com" } },
    },
    {
      method: "Target.targetCreated",
      payload: {
        targetInfo: {
          targetId: "OOPIF-1",
          type: "iframe",
          url: "https://cdn.example.com/frame.html",
          openerId: "PAGE-0",
        },
      },
    },
  ],
  // Both are still live at the boundary, which is what the snapshot reports.
  [
    { targetId: "PAGE-0", type: "page", url: "https://example.com" },
    {
      targetId: "OOPIF-1",
      type: "iframe",
      url: "https://cdn.example.com/frame.html",
      openerId: "PAGE-0",
    },
  ]);
  const browser = {
    ...makeHarFakeBrowser({ log: { entries: [] } }),
    newBrowserCDPSession: session.open,
  };

  try {
    await captureHar({ browser, url: "https://example.com", outDir });

    // Discovery has to be switched on, or nothing is ever reported.
    expect(session.sent).toContain("Target.setDiscoverTargets");

    const targets = JSON.parse(readFileSync(join(outDir, "targets.json"), "utf8"));
    expect(targets.schemaVersion).toBe(1);
    expect(targets.targets).toHaveLength(2);
    // The shape is `targets.ts`'s `TargetEntry`, not whatever CDP happened to send, and the
    // opener relationship survives into the archive.
    expect(targets.targets[1]).toMatchObject({
      targetId: "OOPIF-1",
      type: "iframe",
      url: "https://cdn.example.com/frame.html",
      openerId: "PAGE-0",
    });
    // Capture-relative, like every other timestamp in the archive.
    expect(typeof targets.targets[1].openedAt).toBe("number");
    expect(targets.targets[1].openedAt).toBeGreaterThanOrEqual(0);

    expect(statSync(join(outDir, "targets.json")).mode & 0o600).toBe(0o600);
    expect(JSON.parse(readFileSync(join(outDir, "checkpoints.json"), "utf8")).targets).toEqual({
      path: "targets.json",
      scope: "run",
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar records closedAt for a target that opens and then goes away", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-targets-closed-"));
  const session = fakeBrowserCdpSession([
    {
      method: "Target.targetCreated",
      payload: { targetInfo: { targetId: "POPUP-1", type: "page", url: "https://example.com/p" } },
    },
    { method: "Target.targetDestroyed", payload: { targetId: "POPUP-1" } },
  ]);
  const browser = {
    ...makeHarFakeBrowser({ log: { entries: [] } }),
    newBrowserCDPSession: session.open,
  };

  try {
    await captureHar({ browser, url: "https://example.com", outDir });

    const [target] = JSON.parse(readFileSync(join(outDir, "targets.json"), "utf8")).targets;
    expect(target.targetId).toBe("POPUP-1");
    // A target that closed is evidence about a window that existed, not a target that never did.
    expect(typeof target.closedAt).toBe("number");
    expect(target.closedAt).toBeGreaterThanOrEqual(target.openedAt);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar stops recording targets once the observation window closes", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-targets-boundary-"));
  const session = fakeBrowserCdpSession(
    [
      {
        method: "Target.targetCreated",
        payload: { targetInfo: { targetId: "PAGE-0", type: "page", url: "https://example.com" } },
      },
    ],
    // PAGE-0 is still live at the boundary, so the snapshot lists it. An empty snapshot here would
    // make the drain close it and the test would stop isolating the guard it names.
    [{ targetId: "PAGE-0", type: "page", url: "https://example.com" }],
  );
  // The capabilities gathered from the page stop at `observingDependencies = false`; the inventory
  // has to stop at the same instant, or it attributes our own teardown to the page.
  const browser = browserEmittingDuringClose(session, {
    method: "Target.targetCreated",
    payload: { targetInfo: { targetId: "TEARDOWN-1", type: "page", url: "https://example.com/late" } },
  });

  try {
    await captureHar({ browser, url: "https://example.com", outDir });

    const targets = JSON.parse(readFileSync(join(outDir, "targets.json"), "utf8"));
    expect(targets.targets.map((entry: { targetId: string }) => entry.targetId)).toEqual(["PAGE-0"]);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar records a target the snapshot reports but discovery never announced", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-targets-snapshot-"));
  // Discovery announces nothing. `Target.getTargets` is the fallback deliverable 2 asks for: a
  // worker that existed before discovery was enabled is still evidence about this run.
  const session = fakeBrowserCdpSession(
    [],
    [{ targetId: "WORKER-1", type: "service_worker", url: "https://example.com/sw.js" }],
  );
  const browser = {
    ...makeHarFakeBrowser({ log: { entries: [] } }),
    newBrowserCDPSession: session.open,
  };

  try {
    await captureHar({ browser, url: "https://example.com", outDir });

    expect(session.sent).toContain("Target.getTargets");
    const [target] = JSON.parse(readFileSync(join(outDir, "targets.json"), "utf8")).targets;
    expect(target).toMatchObject({
      targetId: "WORKER-1",
      type: "service_worker",
      url: "https://example.com/sw.js",
    });
    expect(target.openedAt).toBeGreaterThanOrEqual(0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar does not close a target created while the snapshot was in flight", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-targets-inflight-"));
  // The snapshot is not atomic: Chromium enumerates, then the response travels back. A popup
  // opened in that window is reported by an event and is legitimately absent from the enumeration
  // — the drain must not read that absence as proof it closed.
  const session = fakeBrowserCdpSession(
    [
      {
        method: "Target.targetCreated",
        payload: { targetInfo: { targetId: "PAGE-0", type: "page", url: "https://example.com" } },
      },
    ],
    [{ targetId: "PAGE-0", type: "page", url: "https://example.com" }],
    [
      {
        method: "Target.targetCreated",
        payload: { targetInfo: { targetId: "LATE-1", type: "page", url: "https://example.com/x" } },
      },
    ],
  );
  const browser = {
    ...makeHarFakeBrowser({ log: { entries: [] } }),
    newBrowserCDPSession: session.open,
  };

  try {
    await captureHar({ browser, url: "https://example.com", outDir });

    const { targets } = JSON.parse(readFileSync(join(outDir, "targets.json"), "utf8"));
    const late = targets.find((entry: { targetId: string }) => entry.targetId === "LATE-1");
    expect(late).toBeDefined();
    expect(late.closedAt).toBeUndefined();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar publishes a target whose opener closed before discovery started", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-targets-event-opener-"));
  // Discovery announces surviving targets when it is switched on. A child whose opener closed
  // before that moment carries an `openerId` naming a target this run never records, and
  // `validateTargets` refuses a dangling reference — so the event path needs the same sanitising
  // the snapshot path has.
  const session = fakeBrowserCdpSession([
    {
      method: "Target.targetCreated",
      payload: {
        targetInfo: {
          targetId: "CHILD-1",
          type: "page",
          url: "https://example.com/c",
          openerId: "GONE-0",
        },
      },
    },
  ]);
  const browser = {
    ...makeHarFakeBrowser({ log: { entries: [] } }),
    newBrowserCDPSession: session.open,
  };

  try {
    await captureHar({ browser, url: "https://example.com", outDir });

    const [target] = JSON.parse(readFileSync(join(outDir, "targets.json"), "utf8")).targets;
    expect(target.targetId).toBe("CHILD-1");
    expect(target.openerId).toBeUndefined();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar keeps a snapshot target whose opener the run never recorded, without the relationship", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-targets-dangling-"));
  // `Target.getTargets` reports whatever exists, in no guaranteed order, and an opener that closed
  // before the snapshot is not in it. `validateTargets` refuses a dangling `openerId`, so merging
  // one verbatim would abort the whole capture over evidence §6.9 calls supplemental.
  const session = fakeBrowserCdpSession(
    [],
    [
      {
        targetId: "OOPIF-9",
        type: "iframe",
        url: "https://cdn.example.com/f.html",
        openerId: "GONE-0",
      },
    ],
  );
  const browser = {
    ...makeHarFakeBrowser({ log: { entries: [] } }),
    newBrowserCDPSession: session.open,
  };

  try {
    await captureHar({ browser, url: "https://example.com", outDir });

    const [target] = JSON.parse(readFileSync(join(outDir, "targets.json"), "utf8")).targets;
    expect(target.targetId).toBe("OOPIF-9");
    // The target existed — that is real evidence. The parent relationship is not something this
    // run can vouch for, so it is dropped rather than asserted.
    expect(target.openerId).toBeUndefined();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar closes a target the snapshot proves is gone, with no destroy event at all", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-targets-drain-"));
  // POPUP-1 is announced open and never destroyed. The boundary snapshot does not list it, which
  // is proof it closed inside the window — the `targetDestroyed` event either never arrived or
  // arrived too late to be observed. The event stream cannot establish this; only the pull can.
  const session = fakeBrowserCdpSession(
    [
      {
        method: "Target.targetCreated",
        payload: { targetInfo: { targetId: "POPUP-1", type: "page", url: "https://example.com/p" } },
      },
    ],
    [{ targetId: "PAGE-0", type: "page", url: "https://example.com" }],
  );
  const browser = {
    ...makeHarFakeBrowser({ log: { entries: [] } }),
    newBrowserCDPSession: session.open,
  };

  try {
    await captureHar({ browser, url: "https://example.com", outDir });

    const { targets } = JSON.parse(readFileSync(join(outDir, "targets.json"), "utf8"));
    const popup = targets.find((entry: { targetId: string }) => entry.targetId === "POPUP-1");
    expect(popup.closedAt).toBeGreaterThanOrEqual(popup.openedAt);
    // The target the snapshot still lists is open, and stays open.
    const page = targets.find((entry: { targetId: string }) => entry.targetId === "PAGE-0");
    expect(page.closedAt).toBeUndefined();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("captureHar does not close a target on a destroy that arrives after the observation window", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "clone-space-record-targets-late-destroy-"));
  const session = fakeBrowserCdpSession(
    [
      {
        method: "Target.targetCreated",
        payload: { targetInfo: { targetId: "PAGE-0", type: "page", url: "https://example.com" } },
      },
    ],
    // PAGE-0 is still live when the snapshot is taken; the destroy arrives later, during close.
    [{ targetId: "PAGE-0", type: "page", url: "https://example.com" }],
  );
  // Closing the context destroys every target it owns. Recording that as a `closedAt` would report
  // our own teardown as a window the page closed.
  const browser = browserEmittingDuringClose(session, {
    method: "Target.targetDestroyed",
    payload: { targetId: "PAGE-0" },
  });

  try {
    await captureHar({ browser, url: "https://example.com", outDir });

    const [target] = JSON.parse(readFileSync(join(outDir, "targets.json"), "utf8")).targets;
    expect(target.targetId).toBe("PAGE-0");
    expect(target.closedAt).toBeUndefined();
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
