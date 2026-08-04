import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startFixtureServers, type FixtureOrigin, type FixtureServers } from "./serve.ts";

type SecondSiteServers = FixtureServers & { capability: FixtureOrigin };

let servers: SecondSiteServers;

beforeAll(async () => {
  servers = (await startFixtureServers()) as SecondSiteServers;
});

afterAll(async () => {
  await servers.stop();
});

describe("the second fixture site", () => {
  test("is reachable from the capability origin", async () => {
    const response = await fetch(servers.capability.url);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('data-fixture-marker="capability-site"');
  });

  test("leaves the primary motion fixture reachable", async () => {
    const response = await fetch(servers.primary.url);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("clone-space-mcp motion fixture");
  });
});
