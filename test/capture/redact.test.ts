import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactHarArchive } from "../../src/capture/redact.ts";

const REDACTED = "[REDACTED]";

type Har = {
  log: {
    entries: Array<{
      request: {
        url: string;
        headers: Array<{ name: string; value: string }>;
        cookies: Array<{ name: string; value: string }>;
        queryString: Array<{ name: string; value: string }>;
        bodySize: number;
        postData: {
          _file: string;
          text: string;
          params: Array<{ name: string; value: string }>;
        };
      };
      response: {
        headers: Array<{ name: string; value: string }>;
        cookies: Array<{ name: string; value: string }>;
        content: { _file: string };
      };
    }>;
  };
};

async function createArchive(har: Har): Promise<{ root: string; harPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "clone-space-redact-"));
  const harPath = join(root, "network.har");
  await writeFile(harPath, `${JSON.stringify(har)}\n`);
  return { root, harPath };
}

test("redacts case-insensitive headers/cookies and synchronizes credential-like query values", async () => {
  const requestBodyPath = "requests/request-body.bin";
  const responseBodyPath = "responses/response-body.txt";
  const { root, harPath } = await createArchive({
    log: {
      entries: [
        {
          request: {
            url: "https://example.test/page?AcCeSs_ToKeN=URL_QUERY_SENTINEL&cLiEnT_SeCrEt=URL_SECRET_SENTINEL&page=2",
            headers: [
              { name: "aUtHoRiZaTiOn", value: "Bearer AUTH_SENTINEL" },
              { name: "cOoKiE", value: "session=HEADER_COOKIE_SENTINEL" },
              { name: "Content-Length", value: "99" },
              { name: "X-Trace", value: "keep-me" },
            ],
            cookies: [
              { name: "SeSsIoN", value: "COOKIE_SENTINEL" },
              { name: "theme", value: "dark" },
            ],
            queryString: [
              { name: "aCcEsS_ToKeN", value: "QUERY_SENTINEL" },
              { name: "cLiEnT_SeCrEt", value: "CLIENT_SECRET_SENTINEL" },
              { name: "page", value: "2" },
            ],
            bodySize: 99,
            postData: {
              _file: requestBodyPath,
              text: "inline request body",
              params: [{ name: "field", value: "REQUEST_PARAM_SENTINEL" }],
            },
          },
          response: {
            headers: [
              { name: "sEt-CoOkIe", value: "response=SET_COOKIE_SENTINEL" },
              { name: "Content-Type", value: "text/plain" },
            ],
            cookies: [{ name: "sId", value: "RESPONSE_COOKIE_SENTINEL" }],
            content: { _file: responseBodyPath },
          },
        },
      ],
    },
  });

  try {
    await mkdir(join(root, "requests"));
    await mkdir(join(root, "responses"));
    await writeFile(join(root, requestBodyPath), "REQUEST_BODY_SENTINEL");
    await writeFile(join(root, responseBodyPath), "SAFE_RESPONSE_BODY");

    await redactHarArchive(harPath);

    const redacted = JSON.parse(await readFile(harPath, "utf8")) as Har;
    const entry = redacted.log.entries[0]!;
    const request = entry.request;
    const response = entry.response;

    expect(request.headers).toEqual([
      { name: "aUtHoRiZaTiOn", value: REDACTED },
      { name: "cOoKiE", value: REDACTED },
      { name: "Content-Length", value: String(Buffer.byteLength(`${REDACTED}\n`)) },
      { name: "X-Trace", value: "keep-me" },
    ]);
    expect(request.cookies).toEqual([
      { name: "SeSsIoN", value: REDACTED },
      { name: "theme", value: REDACTED },
    ]);
    expect(request.queryString).toEqual([
      { name: "aCcEsS_ToKeN", value: REDACTED },
      { name: "cLiEnT_SeCrEt", value: REDACTED },
      { name: "page", value: "2" },
    ]);
    expect(new URL(request.url).searchParams.get("AcCeSs_ToKeN")).toBe(
      request.queryString[0]!.value,
    );
    expect(new URL(request.url).searchParams.get("cLiEnT_SeCrEt")).toBe(
      request.queryString[1]!.value,
    );
    expect(request.postData).toMatchObject({
      _file: requestBodyPath,
      text: "",
      params: [],
    });
    expect(request.bodySize).toBe(Buffer.byteLength(`${REDACTED}\n`));
    expect(await readFile(join(root, requestBodyPath), "utf8")).toBe(`${REDACTED}\n`);
    expect(response.headers).toEqual([
      { name: "sEt-CoOkIe", value: REDACTED },
      { name: "Content-Type", value: "text/plain" },
    ]);
    expect(response.cookies).toEqual([{ name: "sId", value: REDACTED }]);
    expect(response.content._file).toBe(responseBodyPath);
    expect(await readFile(join(root, responseBodyPath), "utf8")).toBe("SAFE_RESPONSE_BODY");
    if (process.platform !== "win32") {
      expect((await stat(root)).mode & 0o777).toBe(0o700);
      expect((await stat(harPath)).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, requestBodyPath))).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, responseBodyPath))).mode & 0o777).toBe(0o600);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses an attached request body that traverses outside the archive", async () => {
  const { root, harPath } = await createArchive({
    log: {
      entries: [
        {
          request: {
            url: "https://example.test",
            headers: [],
            cookies: [],
            queryString: [],
            bodySize: 1,
            postData: { _file: "../outside.txt", text: "", params: [] },
          },
          response: { headers: [], cookies: [], content: { _file: "response.txt" } },
        },
      ],
    },
  });
  const outsidePath = join(root, "..", "outside.txt");

  try {
    await writeFile(outsidePath, "OUTSIDE_SENTINEL");
    await expect(redactHarArchive(harPath)).rejects.toThrow(/escapes archive root/);
    expect(await readFile(outsidePath, "utf8")).toBe("OUTSIDE_SENTINEL");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsidePath, { force: true });
  }
});

test("refuses a symlinked attached body that escapes the archive when symlinks are supported", async () => {
  const { root, harPath } = await createArchive({
    log: {
      entries: [
        {
          request: {
            url: "https://example.test",
            headers: [],
            cookies: [],
            queryString: [],
            bodySize: 1,
            postData: { _file: "linked-body.txt", text: "", params: [] },
          },
          response: { headers: [], cookies: [], content: { _file: "response.txt" } },
        },
      ],
    },
  });
  const outsideRoot = await mkdtemp(join(tmpdir(), "clone-space-redact-outside-"));
  const outsidePath = join(outsideRoot, "outside.txt");
  const linkPath = join(root, "linked-body.txt");

  try {
    await writeFile(outsidePath, "SYMLINK_TARGET_SENTINEL");
    try {
      await symlink(outsidePath, linkPath, "file");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM" || code === "ENOTSUP") return;
      throw error;
    }

    await expect(redactHarArchive(harPath)).rejects.toThrow(/symbolic link|outside archive root/);
    expect(await readFile(outsidePath, "utf8")).toBe("SYMLINK_TARGET_SENTINEL");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
