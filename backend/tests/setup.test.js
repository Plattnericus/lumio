import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

let app;
let tmpDir;
let db;
let setupTokenPath;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-setup-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");
  setupTokenPath = path.join(tmpDir, "setup-token.txt");
  process.env.SETUP_TOKEN_PATH = setupTokenPath;

  ({ db } = await import("../src/db/index.js"));
  const { ensureSetupToken } = await import("../src/services/setupTokenService.js");
  ensureSetupToken();
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/setup/status", () => {
  it("reports needsSetup: true on a fresh database", async () => {
    const res = await request(app).get("/api/setup/status");
    expect(res.status).toBe(200);
    expect(res.body.needsSetup).toBe(true);
  });
});

describe("POST /api/setup", () => {
  it("rejects an invalid password without consuming the token", async () => {
    const res = await request(app)
      .post("/api/setup")
      .send({ username: "admin", password: "short", setupToken: "irrelevant-wrong-token" });

    expect(res.status).toBe(400);
    // Credential validation runs before the token check, so a short
    // password should fail here regardless of the token being wrong -
    // and the real token file must still be untouched afterward.
    expect(fs.existsSync(setupTokenPath)).toBe(true);
  });

  it("rejects a wrong setup token", async () => {
    const res = await request(app)
      .post("/api/setup")
      .send({ username: "admin", password: "correct-horse-battery", setupToken: "wrong-token" });

    expect(res.status).toBe(403);
    expect(fs.existsSync(setupTokenPath)).toBe(true);
  });

  it("creates the first account as admin with the correct token, and logs it in", async () => {
    const realToken = fs.readFileSync(setupTokenPath, "utf8").trim();
    const agent = request.agent(app);

    const res = await agent
      .post("/api/setup")
      .send({ username: "admin", password: "correct-horse-battery", setupToken: realToken });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe("admin");
    expect(res.body.role).toBe("admin");
    expect(typeof res.body.csrfToken).toBe("string");
    expect(res.headers["set-cookie"]).toBeDefined();

    // Token is single-use.
    expect(fs.existsSync(setupTokenPath)).toBe(false);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.role).toBe("admin");

    const status = await request(app).get("/api/setup/status");
    expect(status.body.needsSetup).toBe(false);
  });

  it("rejects a second setup attempt once an account exists", async () => {
    const res = await request(app)
      .post("/api/setup")
      .send({ username: "someone-else", password: "correct-horse-battery", setupToken: "does-not-matter" });

    expect(res.status).toBe(409);
    expect(db.prepare("SELECT COUNT(*) as count FROM users").get().count).toBe(1);
  });
});
