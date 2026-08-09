import { mkdir, mkdtemp, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  collectEnvironment,
  type EnvironmentV1,
  type EnvironmentPage,
  type ReplayContext,
  type StorageAllowlist,
} from "./environment.ts";
import { validateStagedArchive } from "./checkpoints.ts";
import { redactHarArchive } from "./redact.ts";
import {
  defaultRequestNormalization,
  REQUEST_NORMALIZATION_FILE_NAME,
} from "./request-normalization.ts";

interface CaptureHarResponse {
  url(): string;
  request(): { resourceType(): string };
  text(): Promise<string>;
}

interface CaptureHarPage extends EnvironmentPage {
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
  on(event: "response", handler: (response: CaptureHarResponse) => void): void;
  on(event: "websocket", handler: () => void): void;
  evaluate<Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
}

interface CaptureHarDomNode {
  children?: CaptureHarDomNode[];
  shadowRoots?: CaptureHarDomNode[];
  contentDocument?: CaptureHarDomNode;
  shadowRootType?: string;
}

interface CaptureHarServiceWorkerRegistrationEvent {
  registrations?: Array<{ scopeURL?: string; isDeleted?: boolean }>;
}

/**
 * The one call the document epoch needs. A `loaderId` is minted per new-document commit, so
 * the same-document routing `history.pushState` drives leaves it untouched — which is the
 * property ADR 0005 requires and a navigation counter does not have. Playwright's
 * `page.on("framenavigated")` fires for same-document routing too, so counting it there hands
 * the page control of the value; reading the loaderId here does not.
 *
 * Measured: `Page.getFrameTree` returns the loaderId without `Page.enable`, so the domain is
 * left off rather than enabled for notifications nothing subscribes to.
 */
interface CaptureHarCdpSession {
  send(method: string, params?: object): Promise<unknown>;
  on(
    event: "ServiceWorker.workerRegistrationUpdated",
    handler: (event: CaptureHarServiceWorkerRegistrationEvent) => void,
  ): void;
}

interface CaptureHarContext {
  request: {
    get(url: string): Promise<unknown>;
  };
  newPage(): Promise<CaptureHarPage>;
  // `unknown` because Playwright's own parameter is `Page | Frame`, and the structural page
  // declared above is neither — a narrower type here makes a real BrowserContext unassignable.
  newCDPSession(page: unknown): Promise<CaptureHarCdpSession>;
  close(): Promise<void>;
}

interface CaptureHarBrowser {
  version(): string;
  newContext(options: Partial<ReplayContext> & {
    recordHar: {
      path: string;
      mode: "full";
      content: "attach";
    };
  }): Promise<CaptureHarContext>;
}

const HAR_FILE_NAME = "network.har";
const CAPABILITIES_FILE_NAME = "capabilities.json";
type CapabilityValue = boolean | "undetermined";

function hasClosedShadowRoot(node: CaptureHarDomNode): boolean {
  if (node.shadowRootType === "closed") return true;
  return [node.children, node.shadowRoots, node.contentDocument].some((descendants) => {
    if (!descendants) return false;
    return Array.isArray(descendants)
      ? descendants.some((child) => hasClosedShadowRoot(child))
      : hasClosedShadowRoot(descendants);
  });
}

export interface CaptureHarOptions {
  browser: CaptureHarBrowser;
  url: string;
  outDir: string;
  environment?: Partial<ReplayContext>;
  browserChannel?: string;
  storageAllowlist?: StorageAllowlist;
}

async function assertEmptyOutputDirectory(path: string): Promise<void> {
  try {
    if ((await readdir(path)).length !== 0) {
      throw new Error(`capture output directory must be empty: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function captureHar(options: CaptureHarOptions): Promise<string> {
  new URL(options.url);
  const archiveRoot = resolve(options.outDir);
  const archiveParent = dirname(archiveRoot);
  await mkdir(archiveParent, { recursive: true });
  await assertEmptyOutputDirectory(archiveRoot);
  const stagingRoot = await mkdtemp(join(archiveParent, `.${basename(archiveRoot)}-capture-`));
  const stagingHarPath = resolve(stagingRoot, HAR_FILE_NAME);
  const runStartedAt = performance.now();

  try {
    const context = await options.browser.newContext({
      recordHar: { path: stagingHarPath, mode: "full", content: "attach" },
      ...options.environment,
    });
    let environment: EnvironmentV1;
    let documentEpoch: string;
    let capabilities: {
      serviceWorkerDependent: CapabilityValue;
      webSocketDependent: CapabilityValue;
      closedShadowRootPresent: CapabilityValue;
      sourcemapDeclared: CapabilityValue;
    };
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      let observingDependencies = true;
      let serviceWorkerDependent = false;
      // The listener and domain are installed before navigation. If either setup step fails,
      // capture aborts instead of publishing an archive with incomplete ServiceWorker coverage;
      // therefore this flag's no-positive undetermined state is unreachable.
      cdp.on("ServiceWorker.workerRegistrationUpdated", (event) => {
        if (!observingDependencies) return;
        if (
          event.registrations?.some(
            (registration) =>
              !registration.isDeleted &&
              registration.scopeURL !== undefined &&
              new URL(registration.scopeURL).origin === new URL(options.url).origin,
          )
        ) {
          serviceWorkerDependent = true;
        }
      });
      await cdp.send("ServiceWorker.enable");

      let webSocketDependent = false;
      // page.on is installed before navigation and reports every WebSocket creation, including
      // an upgrade that is refused; listener setup failure aborts capture, so undetermined is
      // unreachable for this flag.
      page.on("websocket", () => {
        if (!observingDependencies) return;
        webSocketDependent = true;
      });

      // Response bodies come from the browser's network stack, not the page, so
      // discovery is not subject to CORS and never issues a second script request.
      const discoveredMapUrls = new Set<string>();
      let sourcemapDeclared = false;
      let scriptBodyUnreadable = false;
      const pendingScriptReads: Promise<void>[] = [];
      page.on("response", (response) => {
        if (response.request().resourceType() !== "script") return;
        pendingScriptReads.push(
          response
            .text()
            .then(
              (source) => {
                const sourceMappingURL = source.match(/\/\/[#@]\s*sourceMappingURL=(\S+)/)?.[1];
                if (sourceMappingURL) {
                  sourcemapDeclared = true;
                  try {
                    discoveredMapUrls.add(new URL(sourceMappingURL, response.url()).href);
                  } catch {
                    // A declaration with an unresolvable URL is still a declaration.
                  }
                }
              },
              () => {
                scriptBodyUnreadable = true;
              },
            ),
        );
      });

      await page.goto(options.url, { waitUntil: "load" });
      await page.evaluate(async () => {
        const waitForCheckpoint = async () => {
          await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
          await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
          await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 75));
        };

        let previousScrollY = -1;
        let previousHeight = -1;
        let emptyCheckpoints = 0;

        while (emptyCheckpoints < 3) {
          const viewportHeight = Math.max(window.innerHeight, 1);
          const scrollHeight = document.documentElement.scrollHeight;
          const maxScrollY = Math.max(scrollHeight - viewportHeight, 0);
          const nextScrollY = Math.min(window.scrollY + viewportHeight * 0.8, maxScrollY);

          window.scrollTo(0, nextScrollY);
          await waitForCheckpoint();

          const currentScrollY = window.scrollY;
          const currentHeight = document.documentElement.scrollHeight;
          if (currentScrollY === previousScrollY && currentHeight === previousHeight) {
            emptyCheckpoints += 1;
          } else {
            emptyCheckpoints = 0;
          }

          previousScrollY = currentScrollY;
          previousHeight = currentHeight;
        }
      });
      let drainedScriptReads = 0;
      while (drainedScriptReads < pendingScriptReads.length) {
        const batch = pendingScriptReads.slice(drainedScriptReads);
        drainedScriptReads = pendingScriptReads.length;
        await Promise.all(batch);
      }
      await Promise.all(
        [...discoveredMapUrls].map((url) => context.request.get(url).catch(() => undefined)),
      );
      // The checkpoint opens after the sweep and spans the environment collection, so the
      // epoch is read at open — the document that is live now, not the one the requested URL
      // asked for — and read again at close.
      const loaderIdAtOpen = (
        (await cdp.send("Page.getFrameTree")) as {
          frameTree: { frame: { loaderId: string } };
        }
      ).frameTree.frame.loaderId;
      const domDocument = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as {
        root: CaptureHarDomNode;
      };
      // DOM.getDocument either returns the complete pierced primary document or capture aborts,
      // so there is no partial DOM coverage to publish as undetermined for this flag.
      const closedShadowRootPresent = hasClosedShadowRoot(domDocument.root);
      environment = await collectEnvironment({
        page,
        url: options.url,
        browserVersion: options.browser.version(),
        browserChannel: options.browserChannel,
        requested: options.environment,
        storageAllowlist: options.storageAllowlist,
      });
      // A same-origin navigation during collection would leave environment.json describing one
      // document under an epoch naming another — an archive that reads as coherent while
      // describing a page that never existed, which is the failure §6.3 exists to detect.
      // ADR 0005: fail closed, so the archive looks incomplete rather than looking complete.
      const loaderIdAtClose = (
        (await cdp.send("Page.getFrameTree")) as {
          frameTree: { frame: { loaderId: string } };
        }
      ).frameTree.frame.loaderId;
      if (loaderIdAtClose !== loaderIdAtOpen) {
        throw new Error("the primary document changed while the checkpoint was open");
      }
      documentEpoch = `epoch:${loaderIdAtOpen}`;
      observingDependencies = false;
      capabilities = {
        serviceWorkerDependent,
        webSocketDependent,
        closedShadowRootPresent,
        sourcemapDeclared: sourcemapDeclared ? true : scriptBodyUnreadable ? "undetermined" : false,
      };
    } finally {
      await context.close();
    }

    const finalCheckpoint = {
      checkpointId: "cp:0",
      primaryTarget: { documentEpoch },
      openedAt: performance.now() - runStartedAt,
      artifacts: [],
    };
    await writeFile(
      resolve(stagingRoot, "environment.json"),
      `${JSON.stringify(
        {
          ...environment,
          checkpoint: {
            checkpointId: finalCheckpoint.checkpointId,
            documentEpoch: finalCheckpoint.primaryTarget.documentEpoch,
            openedAt: finalCheckpoint.openedAt,
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      resolve(stagingRoot, CAPABILITIES_FILE_NAME),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          flags: capabilities,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      resolve(stagingRoot, REQUEST_NORMALIZATION_FILE_NAME),
      `${JSON.stringify(defaultRequestNormalization(), null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      resolve(stagingRoot, "checkpoints.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          har: { path: HAR_FILE_NAME, scope: "run" },
          capabilities: { path: CAPABILITIES_FILE_NAME, scope: "run" },
          requestNormalization: { path: REQUEST_NORMALIZATION_FILE_NAME, scope: "run" },
          checkpoints: [finalCheckpoint],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await redactHarArchive(stagingHarPath);
    const staged = await validateStagedArchive(stagingRoot);
    if (!staged.ok) {
      throw new Error("staged archive failed checkpoint coherence validation");
    }
    await assertEmptyOutputDirectory(archiveRoot);
    try {
      await rmdir(archiveRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(stagingRoot, archiveRoot);
    return resolve(archiveRoot, "network.har");
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}
