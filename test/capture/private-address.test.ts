import { describe, expect, test } from "bun:test";
import {
  privateAddressKind,
  privateNetworkEntries,
  webSocketToPrivateAddress,
} from "../../src/capture/private-address.ts";

describe("privateAddressKind", () => {
  test("classifies the bracketed IPv6 form Playwright writes into the HAR", () => {
    // Measured: 11 of 12 entries of a fixture capture carried "[::1]" and one carried "::1".
    // `isIP("[::1]")` is 0, so anything that classifies before stripping the brackets reports
    // the address this exists to catch as public.
    expect(privateAddressKind("[::1]")).toBe("loopback");
    expect(privateAddressKind("::1")).toBe("loopback");
    expect(privateAddressKind("[fe80::1]")).toBe("link-local");
    expect(privateAddressKind("[::ffff:127.0.0.1]")).toBe("loopback");
  });

  test("classifies the IPv4 ranges that are not somewhere on the internet", () => {
    expect(privateAddressKind("127.0.0.1")).toBe("loopback");
    expect(privateAddressKind("169.254.169.254")).toBe("link-local");
    expect(privateAddressKind("10.0.0.5")).toBe("private");
    expect(privateAddressKind("172.16.0.1")).toBe("private");
    expect(privateAddressKind("192.168.1.1")).toBe("private");
    expect(privateAddressKind("0.0.0.0")).toBe("unspecified");
  });

  test("classifies the whole of fe80::/10, not only addresses beginning fe80", () => {
    // Link-local is fe80::/10 — first hextet fe80 through febf. Checking the literal prefix
    // "fe80:" leaves fe81:: to febf:: classified as somewhere on the internet.
    expect(privateAddressKind("fe90::1")).toBe("link-local");
    expect(privateAddressKind("febf::1")).toBe("link-local");
    expect(privateAddressKind("fe80::1")).toBe("link-local");
    // fec0::/10 is the deprecated site-local block and is not link-local; it stays out.
    expect(privateAddressKind("fec0::1")).toBeUndefined();
  });

  test("classifies an IPv4-mapped address written in hexadecimal", () => {
    // ::ffff:7f00:1 and ::ffff:127.0.0.1 are the same address. Matching only the dotted tail
    // makes the classifier depend on which form the reporter chose to print.
    expect(privateAddressKind("::ffff:7f00:1")).toBe("loopback");
    expect(privateAddressKind("[::ffff:a00:1]")).toBe("private");
    expect(privateAddressKind("::ffff:a9fe:a9fe")).toBe("link-local");
    expect(privateAddressKind("::ffff:5db8:d822")).toBeUndefined();
  });

  test("classifies shared address space, which a machine on Tailscale or behind CGNAT can reach", () => {
    // 100.64.0.0/10 is not routable on the public internet, so a response can only come from it
    // over an overlay or a carrier network the capture host is inside.
    expect(privateAddressKind("100.64.0.1")).toBe("shared");
    expect(privateAddressKind("100.127.255.255")).toBe("shared");
    expect(privateAddressKind("100.63.255.255")).toBeUndefined();
    expect(privateAddressKind("100.128.0.0")).toBeUndefined();
  });

  test("leaves a public address and a non-address unclassified", () => {
    expect(privateAddressKind("93.184.216.34")).toBeUndefined();
    expect(privateAddressKind("[2606:2800:220:1:248:1893:25c8:1946]")).toBeUndefined();
    expect(privateAddressKind("")).toBeUndefined();
    expect(privateAddressKind(undefined)).toBeUndefined();
  });
});

describe("privateNetworkEntries", () => {
  test("reports a subresource served from a private address under a public document", () => {
    // #162 case 1: the document origin passes every name-based check and the page then fetches
    // cloud instance metadata itself. Nothing before this looked at a HAR entry's address.
    const found = privateNetworkEntries([
      { request: { url: "https://example.com/" }, serverIPAddress: "93.184.216.34" },
      {
        request: { url: "http://169.254.169.254/latest/meta-data/" },
        serverIPAddress: "169.254.169.254",
      },
    ]);
    expect(found).toEqual([
      {
        url: "http://169.254.169.254/latest/meta-data/",
        address: "169.254.169.254",
        kind: "link-local",
      },
    ]);
  });

  test("reports the document itself when a name resolved public and the connection went private", () => {
    // #162 cases 2 and 3: DNS rebinding between the pre-flight lookup and the navigation, and a
    // same-host rebind that never differs from `primaryOrigin` so the origin policy never runs.
    // The address is a fact about the connection that happened, so both arrive here as one rule.
    const found = privateNetworkEntries([
      { request: { url: "https://rebound.example/" }, serverIPAddress: "[fe80::1]" },
    ]);
    expect(found).toEqual([
      { url: "https://rebound.example/", address: "[fe80::1]", kind: "link-local" },
    ]);
  });

  test("passes an entry with no recorded address", () => {
    // A cached or service-worker-served entry opened no connection. Absent is not evidence of a
    // private address, and refusing on absence would refuse archives that are fine.
    expect(
      privateNetworkEntries([
        { request: { url: "https://example.com/app.js" } },
        { request: { url: "https://example.com/logo.png" }, serverIPAddress: "" },
      ]),
    ).toEqual([]);
  });

  test("passes an archive served entirely from public addresses", () => {
    expect(
      privateNetworkEntries([
        { request: { url: "https://example.com/" }, serverIPAddress: "93.184.216.34" },
        { request: { url: "https://cdn.example/x.js" }, serverIPAddress: "151.101.1.1" },
      ]),
    ).toEqual([]);
  });
});

describe("webSocketToPrivateAddress", () => {
  /**
   * #185. A WebSocket entry carries **no `serverIPAddress` at all** — measured on the fixture,
   * where the document and XHR entries beside it carry `"[::1]"` and the socket carries nothing.
   * `privateNetworkEntries` passes an entry with no address on purpose, because a cached or
   * ServiceWorker response opened no connection, so a socket to a private address is published.
   *
   * The only signal such an entry offers is its URL host, which is the name-based check the
   * address rule exists because it could not answer. It is adopted here **for this one entry kind
   * and only when the host is a literal IP** — a hostname is not resolved, because resolving one
   * at publish time would be the same time-shifted check wearing a new hat.
   */
  test("reports a socket opened to a literal private address", () => {
    expect(
      webSocketToPrivateAddress([
        { request: { url: "ws://127.0.0.1:8080/socket" }, _resourceType: "websocket" },
        { request: { url: "wss://[fe80::1]/socket" }, _resourceType: "websocket" },
      ]),
    ).toEqual([
      { url: "ws://127.0.0.1:8080/socket", address: "127.0.0.1", kind: "loopback" },
      { url: "wss://[fe80::1]/socket", address: "fe80::1", kind: "link-local" },
    ]);
  });

  test("passes a socket to a public literal address", () => {
    expect(
      webSocketToPrivateAddress([
        { request: { url: "wss://93.184.216.34/socket" }, _resourceType: "websocket" },
      ]),
    ).toEqual([]);
  });

  test("passes a socket to a hostname, and says nothing about where it resolved", () => {
    // Deliberate. Resolving it here would be a lookup at a moment that is not the moment the
    // socket opened — the exact property #162 concluded cannot answer the question. A rebound
    // hostname on a WebSocket stays uncovered, and the issue says so rather than the code
    // pretending otherwise.
    expect(
      webSocketToPrivateAddress([
        { request: { url: "wss://rebound.example/socket" }, _resourceType: "websocket" },
      ]),
    ).toEqual([]);
  });

  test("ignores an entry that is not a WebSocket, whatever its URL", () => {
    // The address rule already covers these, and covering them twice with a weaker signal would
    // let a cached response to a literal private URL be refused on evidence nobody checked.
    expect(
      webSocketToPrivateAddress([
        { request: { url: "http://127.0.0.1/page" }, _resourceType: "document" },
        { request: { url: "http://127.0.0.1/api" } },
      ]),
    ).toEqual([]);
  });

  test("ignores a WebSocket entry that already carries an address", () => {
    // If Playwright ever starts recording one, the address rule is the better evidence and this
    // one steps aside rather than reporting the same entry twice.
    expect(
      webSocketToPrivateAddress([
        {
          request: { url: "ws://127.0.0.1/socket" },
          _resourceType: "websocket",
          serverIPAddress: "127.0.0.1",
        },
      ]),
    ).toEqual([]);
  });

  test("passes a malformed entry rather than throwing on it", () => {
    expect(
      webSocketToPrivateAddress([
        { request: { url: "not a url" }, _resourceType: "websocket" },
        { request: {}, _resourceType: "websocket" },
        "not an entry" as unknown as { request: { url: string } },
      ]),
    ).toEqual([]);
  });
});
