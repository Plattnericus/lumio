import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";

let app;
let tmpDir;
let agent;
let csrfToken;
let db;

const USERNAME = "tester";
const PASSWORD = "correct-horse-battery-staple";

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-upload-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");
  process.env.MAX_UPLOAD_MB = "1";

  const { createAccount } = await import("../src/services/authService.js");
  ({ db } = await import("../src/db/index.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();
  await createAccount(USERNAME, PASSWORD);

  agent = request.agent(app);
  const loginRes = await agent.post("/api/auth/login").send({ username: USERNAME, password: PASSWORD });
  csrfToken = loginRes.body.csrfToken;
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /api/files", () => {
  it("accepts a real PNG and generates a thumbnail", async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const res = await agent
      .post("/api/files")
      .set("X-CSRF-Token", csrfToken)
      .attach("file", png, "photo.png");

    expect(res.status).toBe(201);
    expect(res.body.extension).toBe("png");
    expect(res.body.hasThumbnail).toBe(true);
  });

  it("rejects a file whose content doesn't match its claimed type", async () => {
    const fakeImage = Buffer.from("this is just plain text, not an image");

    const res = await agent
      .post("/api/files")
      .set("X-CSRF-Token", csrfToken)
      .attach("file", fakeImage, "photo.png");

    expect(res.status).toBe(415);
  });

  it("rejects a file over the configured size limit", async () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024, 1); // 2MB, limit is 1MB

    const res = await agent
      .post("/api/files")
      .set("X-CSRF-Token", csrfToken)
      .attach("file", oversized, "big.pdf");

    expect(res.status).toBe(413);
  });

  it("sanitizes a path-traversal attempt in the original filename", async () => {
    const png = await sharp({
      create: { width: 5, height: 5, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const res = await agent
      .post("/api/files")
      .set("X-CSRF-Token", csrfToken)
      .attach("file", png, "../../../../etc/passwd.png");

    expect(res.status).toBe(201);
    // Display name is reduced to a bare basename - no directory components.
    expect(res.body.originalName).toBe("passwd.png");

    // And nothing escaped the configured upload directory.
    const uploadDir = path.join(tmpDir, "uploads");
    const entries = fs.readdirSync(uploadDir);
    expect(entries.every((name) => !name.includes(".."))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "etc"))).toBe(false);
  });

  it("rejects uploads without a session", async () => {
    const res = await request(app).post("/api/files").attach("file", Buffer.from("x"), "x.pdf");
    expect(res.status).toBe(401);
  });
});
