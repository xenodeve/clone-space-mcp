import { chmod, lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const REDACTED_VALUE = "[REDACTED]";
const REDACTED_BODY = `${REDACTED_VALUE}\n`;

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "code",
  "credential",
  "id_token",
  "key",
  "password",
  "passwd",
  "refresh_token",
  "secret",
  "session",
  "sig",
  "signature",
  "token",
]);

type HarNamedValue = { name?: unknown; value?: unknown };
type HarContent = { _file?: unknown };
type HarPostData = HarContent & { text?: unknown; params?: unknown };
type HarEntry = {
  request?: {
    url?: unknown;
    headers?: unknown;
    cookies?: unknown;
    queryString?: unknown;
    bodySize?: unknown;
    postData?: HarPostData;
  };
  response?: {
    headers?: unknown;
    cookies?: unknown;
    content?: HarContent;
  };
};

function namedValues(value: unknown): HarNamedValue[] {
  return Array.isArray(value) ? (value as HarNamedValue[]) : [];
}

function redactNamedValues(values: unknown, sensitiveNames?: Set<string>): void {
  for (const item of namedValues(values)) {
    if (typeof item.name !== "string") continue;
    if (!sensitiveNames || sensitiveNames.has(item.name.toLowerCase())) {
      item.value = REDACTED_VALUE;
    }
  }
}

function redactUrlQuery(rawUrl: unknown): void | string {
  if (typeof rawUrl !== "string") return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }

  let changed = false;
  const redacted = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      redacted.append(key, REDACTED_VALUE);
      changed = true;
    } else {
      redacted.append(key, value);
    }
  }
  if (changed) parsed.search = redacted.toString();
  return changed ? parsed.href : rawUrl;
}

function staysWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

async function resolveAttachedFile(root: string, reference: unknown): Promise<string | undefined> {
  if (reference === undefined) return;
  if (typeof reference !== "string" || reference.length === 0 || isAbsolute(reference)) {
    throw new Error("HAR attachment path must be a non-empty relative path");
  }

  const candidate = resolve(root, reference);
  if (!staysWithin(root, candidate)) {
    throw new Error(`HAR attachment escapes archive root: ${reference}`);
  }
  if ((await lstat(candidate)).isSymbolicLink()) {
    throw new Error(`HAR attachment must not be a symbolic link: ${reference}`);
  }
  const resolvedRoot = await realpath(root);
  const resolvedFile = await realpath(candidate);
  if (!staysWithin(resolvedRoot, resolvedFile)) {
    throw new Error(`HAR attachment resolves outside archive root: ${reference}`);
  }
  return resolvedFile;
}

function updateContentLength(headers: unknown): void {
  for (const header of namedValues(headers)) {
    if (typeof header.name === "string" && header.name.toLowerCase() === "content-length") {
      header.value = String(Buffer.byteLength(REDACTED_BODY));
    }
  }
}

export async function redactHarArchive(harPath: string): Promise<void> {
  const absoluteHarPath = resolve(harPath);
  const archiveRoot = dirname(absoluteHarPath);
  const har = JSON.parse(await readFile(absoluteHarPath, "utf8")) as {
    log?: { entries?: unknown };
  };
  const entries = Array.isArray(har.log?.entries) ? (har.log.entries as HarEntry[]) : [];
  const publishedFiles = new Set<string>([absoluteHarPath]);

  for (const entry of entries) {
    const request = entry.request;
    if (request) {
      redactNamedValues(request.headers, SENSITIVE_HEADERS);
      redactNamedValues(request.cookies);
      redactNamedValues(request.queryString, SENSITIVE_QUERY_KEYS);
      const redactedUrl = redactUrlQuery(request.url);
      if (redactedUrl !== undefined) request.url = redactedUrl;

      const requestBody = await resolveAttachedFile(archiveRoot, request.postData?._file);
      if (requestBody) {
        await writeFile(requestBody, REDACTED_BODY, { mode: 0o600 });
        publishedFiles.add(requestBody);
        request.bodySize = Buffer.byteLength(REDACTED_BODY);
        request.postData!.text = "";
        request.postData!.params = [];
        updateContentLength(request.headers);
      }
    }

    const response = entry.response;
    if (response) {
      redactNamedValues(response.headers, SENSITIVE_HEADERS);
      redactNamedValues(response.cookies);
      const responseBody = await resolveAttachedFile(archiveRoot, response.content?._file);
      if (responseBody) publishedFiles.add(responseBody);
    }
  }

  await writeFile(absoluteHarPath, `${JSON.stringify(har, null, 2)}\n`, { mode: 0o600 });
  await chmod(archiveRoot, 0o700);
  await Promise.all([...publishedFiles].map((path) => chmod(path, 0o600)));
}
