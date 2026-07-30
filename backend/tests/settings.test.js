import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

let app;
let tmpDir;
let db;
let adminAgent;
let adminCsrf;
let userAgent;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-settings-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");

  const { createAccount } = await import("../src/services/authService.js");
  ({ db } = await import("../src/db/index.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();

  await createAccount("admin-user", "correct-horse-battery", "admin");
  await createAccount("plain-user", "correct-horse-battery", "user");

  adminAgent = request.agent(app);
  const adminLogin = await adminAgent
    .post("/api/auth/login")
    .send({ username: "admin-user", password: "correct-horse-battery" });
  adminCsrf = adminLogin.body.csrfToken;

  userAgent = request.agent(app);
  await userAgent.post("/api/auth/login").send({ username: "plain-user", password: "correct-horse-battery" });
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/settings", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin", async () => {
    const res = await userAgent.get("/api/settings");
    expect(res.status).toBe(403);
  });

  it("defaults auto-update to disabled", async () => {
    const res = await adminAgent.get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body.autoUpdateEnabled).toBe(false);
  });
});

describe("PUT /api/settings", () => {
  it("rejects a non-admin", async () => {
    const res = await userAgent.put("/api/settings").send({ autoUpdateEnabled: true });
    expect(res.status).toBe(403);
  });

  it("lets an admin enable auto-update, and it sticks", async () => {
    const put = await adminAgent
      .put("/api/settings")
      .set("X-CSRF-Token", adminCsrf)
      .send({ autoUpdateEnabled: true });
    expect(put.status).toBe(200);
    expect(put.body.autoUpdateEnabled).toBe(true);

    const get = await adminAgent.get("/api/settings");
    expect(get.body.autoUpdateEnabled).toBe(true);
  });
});
