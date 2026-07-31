import { chmod, lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

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
  "accesskey",
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

const URI_HEADERS = new Set(["content-location", "location", "referer"]);

type HarNamedValue = { name?: unknown; value?: unknown };
type HarContent = { _file?: unknown; size?: unknown };
type HarPostData = HarContent & { text?: unknown; params?: unknown };
type HarEntry = {
  _resourceType?: unknown;
  request?: {
    url?: unknown;
    headers?: unknown;
    cookies?: unknown;
    queryString?: unknown;
    bodySize?: unknown;
    postData?: HarPostData;
  };
  response?: {
    bodySize?: unknown;
    headers?: unknown;
    cookies?: unknown;
    content?: HarContent;
    redirectURL?: unknown;
  };
};

function namedValues(value: unknown): HarNamedValue[] {
  return Array.isArray(value) ? (value as HarNamedValue[]) : [];
}

function normalizedName(name: string): string {
  return name.toLowerCase().replaceAll(/[-_.]/g, "");
}

function isSensitiveHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  const normalized = normalizedName(name);
  return (
    SENSITIVE_HEADERS.has(lower) ||
    normalized.includes("apikey") ||
    normalized.endsWith("accesskey") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secretkey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("credential")
  );
}

function isSensitiveQueryKey(name: string): boolean {
  const normalized = normalizedName(name);
  return (
    [...SENSITIVE_QUERY_KEYS].some((key) => normalizedName(key) === normalized) ||
    normalized.endsWith("accesskey") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("credential") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("secretkey") ||
    normalized.endsWith("signature") ||
    normalized.endsWith("token")
  );
}

function redactNamedValues(
  values: unknown,
  isSensitive: (name: string) => boolean = () => true,
): void {
  for (const item of namedValues(values)) {
    if (typeof item.name !== "string") continue;
    if (isSensitive(item.name)) {
      item.value = REDACTED_VALUE;
    }
  }
}

function redactUrlCredentials(rawUrl: unknown, baseUrl?: string): void | string {
  if (typeof rawUrl !== "string") return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return;
  }

  let changed = parsed.username.length > 0 || parsed.password.length > 0;
  if (parsed.username.length > 0) parsed.username = REDACTED_VALUE;
  if (parsed.password.length > 0) parsed.password = REDACTED_VALUE;
  const redacted = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (isSensitiveQueryKey(key)) {
      redacted.append(key, REDACTED_VALUE);
      changed = true;
    } else {
      redacted.append(key, value);
    }
  }
  if (changed) parsed.search = redacted.toString();
  if (!changed) return rawUrl;
  if (baseUrl && rawUrl.startsWith("/")) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return parsed.href;
}

function redactUriHeaderValues(headers: unknown, baseUrl?: string): void {
  for (const header of namedValues(headers)) {
    if (
      typeof header.name !== "string" ||
      typeof header.value !== "string" ||
      !URI_HEADERS.has(header.name.toLowerCase())
    ) {
      continue;
    }
    const redacted = redactUrlCredentials(header.value, baseUrl);
    if (redacted !== undefined) header.value = redacted;
  }
}

function staysWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
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
  const attachmentStat = await lstat(candidate);
  if (attachmentStat.isSymbolicLink()) {
    throw new Error(`HAR attachment must not be a symbolic link: ${reference}`);
  }
  if (!attachmentStat.isFile()) {
    throw new Error(`HAR attachment must be a regular file: ${reference}`);
  }
  if (attachmentStat.nlink !== 1) {
    throw new Error(`HAR attachment must not have multiple hard links: ${reference}`);
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

function collectParentDirectories(root: string, file: string, directories: Set<string>): void {
  let current = dirname(file);
  while (staysWithin(root, current)) {
    directories.add(current);
    if (current === root) return;
    current = dirname(current);
  }
}

export async function redactHarArchive(harPath: string): Promise<void> {
  const absoluteHarPath = resolve(harPath);
  const archiveRoot = dirname(absoluteHarPath);
  await chmod(archiveRoot, 0o700);
  const har = JSON.parse(await readFile(absoluteHarPath, "utf8")) as {
    log?: { entries?: unknown };
  };
  const entries = Array.isArray(har.log?.entries) ? (har.log.entries as HarEntry[]) : [];
  const publishedFiles = new Set<string>([absoluteHarPath]);
  const publishedDirectories = new Set<string>([archiveRoot]);

  for (const entry of entries) {
    const request = entry.request;
    if (request) {
      redactNamedValues(request.headers, isSensitiveHeaderName);
      redactUriHeaderValues(
        request.headers,
        typeof request.url === "string" ? request.url : undefined,
      );
      redactNamedValues(request.cookies);
      redactNamedValues(request.queryString, isSensitiveQueryKey);
      const redactedUrl = redactUrlCredentials(request.url);
      if (redactedUrl !== undefined) request.url = redactedUrl;

      const requestBody = await resolveAttachedFile(archiveRoot, request.postData?._file);
      if (requestBody) {
        await writeFile(requestBody, REDACTED_BODY, { mode: 0o600 });
        publishedFiles.add(requestBody);
        collectParentDirectories(archiveRoot, requestBody, publishedDirectories);
        request.bodySize = Buffer.byteLength(REDACTED_BODY);
        request.postData!.text = "";
        request.postData!.params = [];
        updateContentLength(request.headers);
      }
    }

    const response = entry.response;
    if (response) {
      redactNamedValues(response.headers, isSensitiveHeaderName);
      const requestUrl = typeof request?.url === "string" ? request.url : undefined;
      redactUriHeaderValues(response.headers, requestUrl);
      redactNamedValues(response.cookies);
      const redactedRedirect = redactUrlCredentials(response.redirectURL, requestUrl);
      if (redactedRedirect !== undefined) response.redirectURL = redactedRedirect;
      const responseBody = await resolveAttachedFile(archiveRoot, response.content?._file);
      if (responseBody) {
        const isWebSocket =
          entry._resourceType === "websocket" ||
          (typeof request?.url === "string" && /^wss?:/i.test(request.url));
        if (isWebSocket) {
          await writeFile(responseBody, REDACTED_BODY, { mode: 0o600 });
          response.bodySize = Buffer.byteLength(REDACTED_BODY);
          if (response.content) response.content.size = Buffer.byteLength(REDACTED_BODY);
        }
        publishedFiles.add(responseBody);
        collectParentDirectories(archiveRoot, responseBody, publishedDirectories);
      }
    }
  }

  await writeFile(absoluteHarPath, `${JSON.stringify(har, null, 2)}\n`, { mode: 0o600 });
  await Promise.all([...publishedDirectories].map((path) => chmod(path, 0o700)));
  await Promise.all([...publishedFiles].map((path) => chmod(path, 0o600)));
}
