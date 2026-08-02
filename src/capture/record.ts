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

interface CaptureHarResponse {
  url(): string;
  request(): { resourceType(): string };
  text(): Promise<string>;
}

interface CaptureHarFrame {
  parentFrame(): CaptureHarFrame | null;
}

interface CaptureHarPage extends EnvironmentPage {
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
  on(event: "response", handler: (response: CaptureHarResponse) => void): void;
  on(event: "framenavigated", handler: (frame: CaptureHarFrame) => void): void;
  evaluate<Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
}

interface CaptureHarContext {
  request: {
    get(url: string): Promise<unknown>;
  };
  newPage(): Promise<CaptureHarPage>;
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
  const stagingHarPath = resolve(stagingRoot, "network.har");
  const runStartedAt = performance.now();

  try {
    const context = await options.browser.newContext({
      recordHar: { path: stagingHarPath, mode: "full", content: "attach" },
      ...options.environment,
    });
    let environment: EnvironmentV1;
    let documentEpoch: string;
    try {
      const page = await context.newPage();
      // Response bodies come from the browser's network stack, not the page, so
      // discovery is not subject to CORS and never issues a second script request.
      const discoveredMapUrls = new Set<string>();
      const pendingScriptReads: Promise<void>[] = [];
      let mainFrameNavigationCount = -1;
      page.on("response", (response) => {
        if (response.request().resourceType() !== "script") return;
        pendingScriptReads.push(
          response
            .text()
            .then((source) => {
              const sourceMappingURL = source.match(/\/\/[#@]\s*sourceMappingURL=(\S+)/)?.[1];
              if (sourceMappingURL) {
                discoveredMapUrls.add(new URL(sourceMappingURL, response.url()).href);
              }
            })
            .catch(() => {}),
        );
      });
      page.on("framenavigated", (frame) => {
        if (frame.parentFrame() === null) mainFrameNavigationCount += 1;
      });

      await page.goto(options.url, { waitUntil: "load" });
      await Promise.all(pendingScriptReads);
      await Promise.all(
        [...discoveredMapUrls].map((url) => context.request.get(url).catch(() => undefined)),
      );

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
      environment = await collectEnvironment({
        page,
        url: options.url,
        browserVersion: options.browser.version(),
        browserChannel: options.browserChannel,
        requested: options.environment,
        storageAllowlist: options.storageAllowlist,
      });
      // Checkpoint opens after the sweep: record the live document, not the request URL.
      documentEpoch = `epoch:${mainFrameNavigationCount}`;
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
      resolve(stagingRoot, "checkpoints.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
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
