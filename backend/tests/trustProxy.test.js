import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// Not exercised through the full app/supertest agent stack like the other
// route tests - this isolates exactly the one thing that matters here:
// does the configured trust-proxy value correctly separate "a hop we trust
// because it's on the internal reverse-proxy chain" from "the real client,"
// including the security-relevant case of a client trying to spoof its own
// X-Forwarded-For entry when connecting directly (no trusted hop for it to
// pass through at all).
let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-trustproxy-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadEnv() {
  vi.resetModules();
  return import("../src/config/env.js");
}

async function buildApp(trustedProxies) {
  process.env.TRUSTED_PROXY_SUBNETS = trustedProxies.join(",");
  const { env } = await loadEnv();
  const app = express();
  app.set("trust proxy", env.trustedProxies);
  app.get("/", (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe("trust proxy configuration", () => {
  it("defaults to loopback only when TRUSTED_PROXY_SUBNETS is unset", async () => {
    delete process.env.TRUSTED_PROXY_SUBNETS;
    const { env } = await loadEnv();
    expect(env.trustedProxies).toEqual(["loopback"]);
  });

  it("resolves the real client through a single trusted hop (today's direct nginx path)", async () => {
    const app = await buildApp(["loopback"]);
    const res = await request(app).get("/").set("X-Forwarded-For", "203.0.113.9");
    expect(res.body.ip).toBe("203.0.113.9");
  });

  it("resolves the real client through two trusted hops (nginx + an added internal proxy)", async () => {
    const app = await buildApp(["loopback", "172.19.0.0/16"]);
    const res = await request(app).get("/").set("X-Forwarded-For", "203.0.113.9, 172.19.0.3");
    expect(res.body.ip).toBe("203.0.113.9");
  });

  it("does not let a direct client spoof its IP via a fake X-Forwarded-For entry", async () => {
    const app = await buildApp(["loopback", "172.19.0.0/16"]);
    // Attacker connects straight to nginx (not through the trusted internal
    // proxy) and sets their own X-Forwarded-For - nginx appends the
    // attacker's real address (6.6.6.6) after it. Since 6.6.6.6 isn't in
    // the trusted range, the walk must stop there, not continue left into
    // the attacker-supplied value.
    const res = await request(app).get("/").set("X-Forwarded-For", "9.9.9.9, 6.6.6.6");
    expect(res.body.ip).toBe("6.6.6.6");
  });
});
