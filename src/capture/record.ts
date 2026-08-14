import { mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
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
import {
  TARGETS_SCHEMA_VERSION,
  appendDiscovered,
  belongsToRun,
  markClosed,
  reconcileWithSnapshot,
  type CdpTargetPayload,
  type TargetEntry,
  type TargetsV1,
} from "./targets.ts";
import {
  assembleChunk,
  drainedEvents,
  TRANSCRIPT_DRAIN_SCRIPT,
  TRANSCRIPT_INIT_SCRIPT,
  TRANSCRIPT_SCHEMA_VERSION,
  type InteractionTranscriptV1,
} from "./transcript.ts";
import { redactHarArchive } from "./redact.ts";
import {
  buildCommit,
  COMMIT_FILE_NAME,
} from "./commit.ts";
import {
  defaultBudgets,
  DRAIN_DEADLINE_MS,
  evaluateBudget,
  settleWithin,
  QUIET_WINDOW_CHECKPOINTS,
  TERMINATION_FILE_NAME,
  terminationOutcome,
  type Budgets,
} from "./budget.ts";
import {
  defaultRequestNormalization,
  findAmbiguousNormalizedRequests,
  normalizePolicyKeys,
  REQUEST_NORMALIZATION_FILE_NAME,
  type HarRequestEntry,
  type RequestNormalizationV1,
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
  evaluate<Result, Arg>(pageFunction: (arg: Arg) => Result | Promise<Result>, arg?: Arg): Promise<Result>;
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

/**
 * The browser-level CDP session §6.9 needs. It is separate from the page session because target
 * discovery reports OOPIFs, popups and workers that no page session can see.
 */
interface CaptureHarBrowserCdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (payload: unknown) => void): void;
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
  /**
   * Optional on purpose. A fake browser in a unit test has no browser-level session, and capture
   * must still complete rather than fail on a capability the archive treats as supplemental.
   */
  newBrowserCDPSession?(): Promise<CaptureHarBrowserCdpSession>;
}

const HAR_FILE_NAME = "network.har";
const CAPABILITIES_FILE_NAME = "capabilities.json";
const TARGETS_FILE_NAME = "targets.json";
const TRANSCRIPT_FILE_NAME = "transcript.json";
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

function countDomNodes(node: CaptureHarDomNode): number {
  let count = 1;
  for (const descendants of [node.children, node.shadowRoots]) {
    if (!descendants) continue;
    for (const child of descendants) count += countDomNodes(child);
  }
  if (node.contentDocument) count += countDomNodes(node.contentDocument);
  return count;
}

export interface CaptureHarOptions {
  browser: CaptureHarBrowser;
  url: string;
  outDir: string;
  environment?: Partial<ReplayContext>;
  browserChannel?: string;
  storageAllowlist?: StorageAllowlist;
  /** Explicit volatile-query-key policy (ADR 0007). Defaults to an empty list. */
  volatileQueryKeys?: readonly string[];
  /** Capture termination budgets (§6.10). Defaults to the documented set. */
  budgets?: Partial<Budgets>;
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
  // Canonicalize the policy before any browser or staging side effect; throws on empty/duplicate keys.
  const volatileKeys = normalizePolicyKeys(options.volatileQueryKeys);
  const sweepBudgets: Budgets = { ...defaultBudgets(), ...options.budgets };
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
    let targets: TargetEntry[] = [];
    let transcript: InteractionTranscriptV1 = {
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      droppedEvents: 0,
      chunks: [],
    };
    let sweepStats: {
      sweepCheckpoints: number;
      scrolls: number;
      wallClockMs: number;
      height: number;
      quietWindow: boolean;
    };
    let nodeCount = 0;
    let capabilities: {
      serviceWorkerDependent: CapabilityValue;
      webSocketDependent: CapabilityValue;
      closedShadowRootPresent: CapabilityValue;
      sourcemapDeclared: CapabilityValue;
    };
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      // §6.9/#122: discovery is browser-wide, so the run has to know which context is its own or a
      // concurrent capture sharing the browser leaks into this inventory. The page session answers
      // for itself; a browser that does not answer leaves this undefined and nothing is filtered.
      const runContextId = ((await cdp.send("Target.getTargetInfo").catch(() => ({}))) as {
        targetInfo?: { browserContextId?: unknown };
      }).targetInfo?.browserContextId;
      const runContext = typeof runContextId === "string" ? runContextId : undefined;
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

      // §6.7/§6.11. Installed after navigation and before the sweep, so every scroll the sweep
      // drives is recorded with the container that actually moved. Events during load are not
      // captured — that needs an init script the browser interface does not expose, and saying so
      // beats publishing a transcript that looks complete.
      await page.evaluate(new Function(TRANSCRIPT_INIT_SCRIPT) as () => void);

      // §6.9 target discovery. Switched on after navigation and before the sweep: Chromium reports
      // `targetCreated` for targets that already exist at the moment discovery is enabled, so the
      // OOPIFs and workers the navigation itself produced are still reported. Opened lazily — a
      // browser without a session-level API leaves the inventory empty rather than failing capture,
      // because this evidence is supplemental to the primary single-document layout.
      //
      // Both handlers respect `observingDependencies`, so the inventory describes the observation
      // window rather than our own teardown. That boundary is on delivery time, not occurrence
      // time: this is a browser-level session, so a destroy the page caused just before the
      // boundary can be delivered after it and lose its `closedAt`. The result is coarser evidence
      // — an absent `closedAt` says the target was still open when the window closed — never a
      // false one. Deliverable 2 of #117, a `Target.getTargets` snapshot taken at the boundary, is
      // what closes that gap, because a recorded target missing from the snapshot is known closed.
      let browserCdp: CaptureHarBrowserCdpSession | undefined;
      if (options.browser.newBrowserCDPSession !== undefined) {
        browserCdp = await options.browser.newBrowserCDPSession();
        browserCdp.on("Target.targetCreated", (payload) => {
          if (!observingDependencies) return;
          const info = (payload as { targetInfo?: CdpTargetPayload }).targetInfo;
          if (info === undefined) return;
          if (!belongsToRun(info, runContext)) return;
          targets = appendDiscovered(targets, info, performance.now() - runStartedAt);
        });
        browserCdp.on("Target.targetDestroyed", (payload) => {
          if (!observingDependencies) return;
          const targetId = (payload as { targetId?: unknown }).targetId;
          if (typeof targetId !== "string") return;
          // A destroy for a target discovery never reported is not evidence of anything, and
          // `markClosed` refuses it. Dropping it keeps a supplemental inventory from aborting a
          // capture over a target the run never saw open.
          if (!targets.some((entry) => entry.targetId === targetId)) return;
          targets = markClosed(targets, targetId, performance.now() - runStartedAt);
        });
        await browserCdp.send("Target.setDiscoverTargets", { discover: true });
      }

      sweepStats = await page.evaluate(async (args: { budgets: Budgets; quietWindowCheckpoints: number }) => {
        const { budgets, quietWindowCheckpoints } = args;
        const waitForCheckpoint = async () => {
          await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
          await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
          await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 75));
        };

        let previousScrollY = -1;
        let previousHeight = -1;
        let previousNodeCount = -1;
        let emptyCheckpoints = 0;
        let scrolls = 0;
        const startedAt = performance.now();

        // A cheap DOM-activity signal: top-level body children count. Catches live pages that
        // append/remove content in place (chat, ticker, feed) without growing scrollHeight,
        // which a full querySelectorAll traversal would be too heavy to check per checkpoint.
        const domNodeCount = () => document.body.childElementCount;

        const stopReason = (): "quiet-window" | "budget-exceeded" | null => {
          if (emptyCheckpoints >= quietWindowCheckpoints) return "quiet-window";
          const elapsed = performance.now() - startedAt;
          const height = document.documentElement.scrollHeight;
          if (
            (budgets.wallClockMs > 0 && elapsed > budgets.wallClockMs) ||
            (budgets.maxHeight > 0 && height > budgets.maxHeight) ||
            (budgets.maxEvents > 0 && scrolls > budgets.maxEvents)
          ) {
            return "budget-exceeded";
          }
          return null;
        };

        while (stopReason() === null) {
          const viewportHeight = Math.max(window.innerHeight, 1);
          const scrollHeight = document.documentElement.scrollHeight;
          const maxScrollY = Math.max(scrollHeight - viewportHeight, 0);
          const nextScrollY = Math.min(window.scrollY + viewportHeight * 0.8, maxScrollY);

          window.scrollTo(0, nextScrollY);
          scrolls += 1;
          await waitForCheckpoint();

          const currentScrollY = window.scrollY;
          const currentHeight = document.documentElement.scrollHeight;
          const currentNodeCount = domNodeCount();
          const quiet = currentScrollY === previousScrollY && currentHeight === previousHeight;
          const domIdle = currentNodeCount === previousNodeCount;
          // A live page that mutates in place (chat, ticker) without growing the document must
          // not look "settled": reset the quiet window when the DOM changed during the checkpoint.
          if (quiet && domIdle) {
            emptyCheckpoints += 1;
          } else {
            emptyCheckpoints = 0;
          }

          previousScrollY = currentScrollY;
          previousHeight = currentHeight;
          previousNodeCount = currentNodeCount;
        }

        return {
          sweepCheckpoints: emptyCheckpoints,
          scrolls,
          wallClockMs: Math.round(performance.now() - startedAt),
          height: document.documentElement.scrollHeight,
          quietWindow: emptyCheckpoints >= quietWindowCheckpoints,
        };
      }, { budgets: sweepBudgets, quietWindowCheckpoints: QUIET_WINDOW_CHECKPOINTS });
      // Bounded, because this runs *after* the sweep and so outside §6.10's wall-clock budget. One
      // script read that never answers would otherwise hold a browser open — and through the MCP
      // tool, the caller's request with it. Giving up loses a sourcemap; not giving up loses the
      // capture and the process.
      let drainedScriptReads = 0;
      while (drainedScriptReads < pendingScriptReads.length) {
        const batch = pendingScriptReads.slice(drainedScriptReads);
        drainedScriptReads = pendingScriptReads.length;
        if (!(await settleWithin(batch, DRAIN_DEADLINE_MS))) break;
      }
      await settleWithin(
        [...discoveredMapUrls].map((url) => context.request.get(url).catch(() => undefined)),
        DRAIN_DEADLINE_MS,
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
      nodeCount = countDomNodes(domDocument.root);
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

      // §6.9 deliverable 2. A pull at a known instant, where the event stream is a filter on
      // pushes: a target that existed before discovery was enabled — or whose `targetCreated`
      // never arrived — is still evidence about this run, and the snapshot is the only thing that
      // can report it.
      if (browserCdp !== undefined) {
        // Taken before the await: the enumeration Chromium is about to build cannot contain a
        // target that does not exist yet, so only what is already recorded may be closed by its
        // absence from the result.
        const drainable = new Set(targets.map((entry) => entry.targetId));
        const snapshot =
          ((await browserCdp.send("Target.getTargets")) as { targetInfos?: CdpTargetPayload[] })
            .targetInfos ?? [];
        targets = reconcileWithSnapshot(
          targets,
          snapshot.filter((info) => belongsToRun(info, runContext)),
          performance.now() - runStartedAt,
          drainable,
        );
      }

      const drained = drainedEvents(
        await page.evaluate(new Function(`return ${TRANSCRIPT_DRAIN_SCRIPT}`) as () => unknown),
      );
      transcript = {
        schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
        droppedEvents: drained.dropped,
        chunks: drained.events.length > 0 ? [assembleChunk(drained.events, 1, 0).chunk] : [],
      };

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
      `${JSON.stringify(
        {
          ...defaultRequestNormalization(),
          query: { volatileKeys, keyMatch: "case-insensitive-exact" },
        } satisfies RequestNormalizationV1,
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      resolve(stagingRoot, TARGETS_FILE_NAME),
      `${JSON.stringify({ schemaVersion: TARGETS_SCHEMA_VERSION, targets } satisfies TargetsV1, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      resolve(stagingRoot, TRANSCRIPT_FILE_NAME),
      `${JSON.stringify(transcript, null, 2)}
`,
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
          termination: { path: TERMINATION_FILE_NAME, scope: "run" },
          targets: { path: TARGETS_FILE_NAME, scope: "run" },
          transcript: { path: TRANSCRIPT_FILE_NAME, scope: "run" },
          commit: { path: COMMIT_FILE_NAME, scope: "run" },
          checkpoints: [finalCheckpoint],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await redactHarArchive(stagingHarPath);
    // §6.10 termination: combine the in-page sweep stats with the post-redaction HAR size and the
    // checkpoint DOM node count, then record why capture stopped so a truncated capture is
    // distinguishable from a complete one.
    const harBytes = (await stat(stagingHarPath)).size;
    const terminationStats = {
      sweepCheckpoints: sweepStats.sweepCheckpoints,
      scrolls: sweepStats.scrolls,
      wallClockMs: sweepStats.wallClockMs,
      bytes: harBytes,
      nodes: nodeCount,
      height: sweepStats.height,
    };
    const terminationDecision = evaluateBudget(sweepBudgets, terminationStats);
    const terminationOutcomeValue = terminationOutcome(terminationDecision);
    await writeFile(
      resolve(stagingRoot, TERMINATION_FILE_NAME),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          ...terminationOutcomeValue,
          budgets: sweepBudgets,
          stats: terminationStats,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    // The producer check: no two distinct archived raw URLs may collapse under the policy for
    // the same method — replay must never be forced to choose between different responses.
    const redactedHar = JSON.parse(await readFile(stagingHarPath, "utf8")) as {
      log?: { entries?: HarRequestEntry[] };
    };
    const harEntries = redactedHar.log?.entries;
    if (harEntries === undefined) {
      throw new Error("capture: redacted HAR has no log.entries");
    }
    const ambiguous = findAmbiguousNormalizedRequests(harEntries, volatileKeys);
    if (ambiguous.length > 0) {
      throw new Error(
        `capture: the volatile-key policy collapses ${ambiguous.length} distinct archived request(s) into one normalized match; ` +
          "refusing to publish an archive replay would have to guess between them",
      );
    }
    const staged = await validateStagedArchive(stagingRoot);
    if (!staged.ok) {
      throw new Error("staged archive failed checkpoint coherence validation");
    }
    // The commit marker is written last, after validation passed and every artifact is present,
    // hashing the exact bytes that were validated so a reader can verify them independently.
    const commit = await buildCommit(stagingRoot, finalCheckpoint.checkpointId);
    await writeFile(
      resolve(stagingRoot, COMMIT_FILE_NAME),
      `${JSON.stringify(commit, null, 2)}\n`,
      { mode: 0o600 },
    );
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
