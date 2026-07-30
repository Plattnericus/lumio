import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";

let app;
let tmpDir;
let db;
let ownerAgent;
let ownerCsrf;
let recipientAgent;
let recipientCsrf;
let strangerAgent;
let fileId;

const PASSWORD = "correct-horse-battery";

async function uploadTestFile(agent, csrf) {
  const png = await sharp({
    create: { width: 6, height: 6, channels: 3, background: { r: 9, g: 9, b: 9 } },
  })
    .png()
    .toBuffer();
  const res = await agent.post("/api/files").set("X-CSRF-Token", csrf).attach("file", png, "shared.png");
  return res.body.id;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-sharing-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");

  const { createAccount } = await import("../src/services/authService.js");
  ({ db } = await import("../src/db/index.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();

  await createAccount("owner", PASSWORD);
  await createAccount("recipient", PASSWORD);
  await createAccount("stranger", PASSWORD);

  ownerAgent = request.agent(app);
  const ownerLogin = await ownerAgent.post("/api/auth/login").send({ username: "owner", password: PASSWORD });
  ownerCsrf = ownerLogin.body.csrfToken;

  recipientAgent = request.agent(app);
  const recipientLogin = await recipientAgent
    .post("/api/auth/login")
    .send({ username: "recipient", password: PASSWORD });
  recipientCsrf = recipientLogin.body.csrfToken;

  strangerAgent = request.agent(app);
  await strangerAgent.post("/api/auth/login").send({ username: "stranger", password: PASSWORD });

  fileId = await uploadTestFile(ownerAgent, ownerCsrf);
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("before sharing", () => {
  it("the stranger gets 404 on every access path (no share exists yet)", async () => {
    const dl = await strangerAgent.get(`/api/files/${fileId}/download`);
    expect(dl.status).toBe(404);
  });

  it("the recipient gets 404 too, before any share exists", async () => {
    const dl = await recipientAgent.get(`/api/files/${fileId}/download`);
    expect(dl.status).toBe(404);
  });
});

describe("sharing a file", () => {
  it("rejects sharing with yourself", async () => {
    const res = await ownerAgent
      .post(`/api/files/${fileId}/shares`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ username: "owner" });
    expect(res.status).toBe(400);
  });

  it("rejects sharing with a nonexistent username, with no dangling row", async () => {
    const res = await ownerAgent
      .post(`/api/files/${fileId}/shares`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ username: "no-such-user" });
    expect(res.status).toBe(404);
    expect(db.prepare("SELECT COUNT(*) as count FROM file_shares").get().count).toBe(0);
  });

  it("shares the file with the recipient", async () => {
    const res = await ownerAgent
      .post(`/api/files/${fileId}/shares`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ username: "recipient" });
    expect(res.status).toBe(201);
  });

  it("sharing the same user again is an idempotent no-op", async () => {
    const res = await ownerAgent
      .post(`/api/files/${fileId}/shares`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ username: "recipient" });
    expect(res.status).toBe(201);
    expect(db.prepare("SELECT COUNT(*) as count FROM file_shares").get().count).toBe(1);
  });
});

describe("after sharing", () => {
  it("the recipient can view/download/thumbnail the file", async () => {
    const download = await recipientAgent.get(`/api/files/${fileId}/download`);
    expect(download.status).toBe(200);

    const thumb = await recipientAgent.get(`/api/files/${fileId}/thumbnail`);
    expect(thumb.status).toBe(200);

    const preview = await recipientAgent.get(`/api/files/${fileId}/preview`);
    expect(preview.status).toBe(200);
  });

  it("the recipient cannot delete the shared file", async () => {
    const res = await recipientAgent.delete(`/api/files/${fileId}`).set("X-CSRF-Token", recipientCsrf);
    expect(res.status).toBe(404);
  });

  it("the recipient cannot re-share the file", async () => {
    const res = await recipientAgent
      .post(`/api/files/${fileId}/shares`)
      .set("X-CSRF-Token", recipientCsrf)
      .send({ username: "stranger" });
    expect(res.status).toBe(404);
  });

  it("the recipient cannot see who else it's shared with (owner-only)", async () => {
    const res = await recipientAgent.get(`/api/files/${fileId}/shares`);
    expect(res.status).toBe(404);
  });

  it("the owner sees the share list", async () => {
    const res = await ownerAgent.get(`/api/files/${fileId}/shares`);
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.username)).toEqual(["recipient"]);
  });

  it("the stranger still gets 404 on every access path", async () => {
    const download = await strangerAgent.get(`/api/files/${fileId}/download`);
    expect(download.status).toBe(404);
    const thumb = await strangerAgent.get(`/api/files/${fileId}/thumbnail`);
    expect(thumb.status).toBe(404);
  });

  it("the file shows under scope=shared for the recipient", async () => {
    const res = await recipientAgent.get("/api/files?scope=shared");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(fileId);
    expect(res.body[0].sharedBy).toBe("owner");
  });

  it("the file still shows under scope=mine for the owner, not scope=shared", async () => {
    const mine = await ownerAgent.get("/api/files?scope=mine");
    expect(mine.body.map((f) => f.id)).toContain(fileId);

    const shared = await ownerAgent.get("/api/files?scope=shared");
    expect(shared.body).toHaveLength(0);
  });

  it("the file does not show under scope=mine for the recipient", async () => {
    const res = await recipientAgent.get("/api/files?scope=mine");
    expect(res.body.map((f) => f.id)).not.toContain(fileId);
  });
});

describe("revoking a share", () => {
  it("removes access immediately", async () => {
    const revoke = await ownerAgent
      .delete(`/api/files/${fileId}/shares/${await recipientUserId()}`)
      .set("X-CSRF-Token", ownerCsrf);
    expect(revoke.status).toBe(204);

    const download = await recipientAgent.get(`/api/files/${fileId}/download`);
    expect(download.status).toBe(404);
  });
});

async function recipientUserId() {
  return db.prepare("SELECT id FROM users WHERE username = ?").get("recipient").id;
}
