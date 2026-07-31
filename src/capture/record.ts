import { resolve } from "node:path";

interface CaptureHarResponse {
  url(): string;
  request(): { resourceType(): string };
  text(): Promise<string>;
}

interface CaptureHarPage {
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
  on(event: "response", handler: (response: CaptureHarResponse) => void): void;
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
  newContext(options: {
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
}

export async function captureHar(options: CaptureHarOptions): Promise<string> {
  const harPath = resolve(options.outDir, "network.har");
  const context = await options.browser.newContext({
    recordHar: { path: harPath, mode: "full", content: "attach" },
  });

  try {
    const page = await context.newPage();
    // Response bodies come from the browser's network stack, not the page, so
    // discovery is not subject to CORS and never issues a second script request.
    const discoveredMapUrls = new Set<string>();
    const pendingScriptReads: Promise<void>[] = [];
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
  } finally {
    await context.close();
  }

  return harPath;
}
