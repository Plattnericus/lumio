import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

let app;
let tmpDir;
let createAccount;
let db;

const USERNAME = "tester";
const PASSWORD = "correct-horse-battery-staple";

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-auth-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");
  process.env.LOGIN_RATE_LIMIT_MAX = "3";
  process.env.LOGIN_LOCKOUT_MINUTES = "15";

  ({ createAccount } = await import("../src/services/authService.js"));
  ({ db } = await import("../src/db/index.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();

  await createAccount(USERNAME, PASSWORD);
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials and returns a csrf token", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe(USERNAME);
    expect(typeof res.body.csrfToken).toBe("string");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects a wrong password with a generic message", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid username or password");
  });

  it("gives the exact same response for a nonexistent username", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "nobody-here", password: "whatever" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid username or password");
  });

  it("locks the account after repeated failures", async () => {
    // Reset failed_attempts from earlier tests with one clean login first,
    // then drive it to the configured limit (LOGIN_RATE_LIMIT_MAX=3).
    await request(app).post("/api/auth/login").send({ username: USERNAME, password: PASSWORD });

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/auth/login")
        .send({ username: USERNAME, password: "wrong-again" });
    }

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many attempts/i);
  });
});

describe("session-protected routes", () => {
  it("rejects /api/auth/me without a session", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});
