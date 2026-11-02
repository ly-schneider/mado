import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { config } from "../config";
import { clientIp } from "./client-ip";

// Real Express apps on loopback, so req.ip and the compiled trust function behave as in production.
function serve(trustProxy: string | number) {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.get("/", (req, res) => {
    res.json({ ip: clientIp(req) });
  });
  return new Promise<Server>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const ipFrom = async (server: Server, headers: Record<string, string>) => {
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/`, { headers });
  return ((await res.json()) as { ip: string | null }).ip;
};

let behindProxy: Server;
let direct: Server;

beforeAll(async () => {
  config.clientIpHeader = "cf-connecting-ip";
  behindProxy = await serve("loopback");
  direct = await serve("10.0.0.0/8");
});

afterAll(() => {
  config.clientIpHeader = null;
  behindProxy.close();
  direct.close();
});

describe("client IP", () => {
  test("takes CLIENT_IP_HEADER from a trusted proxy", async () => {
    expect(await ipFrom(behindProxy, { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })).toBe("203.0.113.7");
  });

  test("falls back to X-Forwarded-For from a trusted proxy", async () => {
    expect(await ipFrom(behindProxy, { "x-forwarded-for": "198.51.100.1" })).toBe("198.51.100.1");
  });

  test("ignores both headers from an untrusted peer", async () => {
    expect(await ipFrom(direct, { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })).toBe("127.0.0.1");
  });

  test("ignores a header value that isn't an address", async () => {
    expect(await ipFrom(behindProxy, { "cf-connecting-ip": "not-an-ip" })).toBe("127.0.0.1");
  });
});
