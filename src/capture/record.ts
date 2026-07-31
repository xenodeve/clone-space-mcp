import { resolve } from "node:path";

interface CaptureHarPage {
  goto(url: string, options: { waitUntil: "load" }): Promise<unknown>;
}

interface CaptureHarContext {
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
    await page.goto(options.url, { waitUntil: "load" });
  } finally {
    await context.close();
  }

  return harPath;
}
