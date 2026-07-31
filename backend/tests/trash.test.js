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
let strangerCsrf;

const PASSWORD = "correct-horse-battery";

async function uploadTestFile(agent, csrf, name) {
  const png = await sharp({
    create: { width: 6, height: 6, channels: 3, background: { r: 3, g: 3, b: 3 } },
  })
    .png()
    .toBuffer();
  const res = await agent.post("/api/files").set("X-CSRF-Token", csrf).attach("file", png, name);
  return res.body.id;
}

function storedPathsFor(fileId) {
  const row = db.prepare("SELECT stored_name FROM files WHERE id = ?").get(fileId);
  const uploadsDir = path.join(tmpDir, "uploads");
  return {
    original: path.join(uploadsDir, row.stored_name),
    thumbnail: path.join(uploadsDir, "thumbnails", `${row.stored_name}.webp`),
    preview: path.join(uploadsDir, "previews", `${row.stored_name}.jpg`),
  };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-trash-test-"));
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
  const strangerLogin = await strangerAgent
    .post("/api/auth/login")
    .send({ username: "stranger", password: PASSWORD });
  strangerCsrf = strangerLogin.body.csrfToken;
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("soft delete and restore round trip", () => {
  let fileId;

  it("moves a file to trash without touching disk bytes", async () => {
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "roundtrip.png");
    const paths = storedPathsFor(fileId);
    expect(fs.existsSync(paths.original)).toBe(true);

    const del = await ownerAgent.delete(`/api/files/${fileId}`).set("X-CSRF-Token", ownerCsrf);
    expect(del.status).toBe(204);

    expect(fs.existsSync(paths.original)).toBe(true);
    expect(fs.existsSync(paths.thumbnail)).toBe(true);
    expect(fs.existsSync(paths.preview)).toBe(true);
  });

  it("disappears from scope=mine", async () => {
    const res = await ownerAgent.get("/api/files?scope=mine");
    expect(res.body.map((f) => f.id)).not.toContain(fileId);
  });

  it("appears under scope=trash with a deletedAt and a server-computed purgeAt", async () => {
    const res = await ownerAgent.get("/api/files?scope=trash");
    const trashed = res.body.find((f) => f.id === fileId);
    expect(trashed).toBeTruthy();
    expect(typeof trashed.deletedAt).toBe("number");
    expect(trashed.purgeAt).toBeGreaterThan(trashed.deletedAt);
  });

  it("deleting an already-trashed file again 404s", async () => {
    const res = await ownerAgent.delete(`/api/files/${fileId}`).set("X-CSRF-Token", ownerCsrf);
    expect(res.status).toBe(404);
  });

  it("restoring brings it back to scope=mine and out of scope=trash", async () => {
    const res = await ownerAgent.post(`/api/files/${fileId}/restore`).set("X-CSRF-Token", ownerCsrf);
    expect(res.status).toBe(204);

    const mine = await ownerAgent.get("/api/files?scope=mine");
    expect(mine.body.map((f) => f.id)).toContain(fileId);

    const trash = await ownerAgent.get("/api/files?scope=trash");
    expect(trash.body.map((f) => f.id)).not.toContain(fileId);
  });

  it("restoring a file that isn't trashed 404s", async () => {
    const res = await ownerAgent.post(`/api/files/${fileId}/restore`).set("X-CSRF-Token", ownerCsrf);
    expect(res.status).toBe(404);
  });
});

describe("permanent delete", () => {
  let fileId;

  beforeAll(async () => {
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "forever.png");
  });

  it("404s if the file isn't already trashed", async () => {
    const res = await ownerAgent.delete(`/api/files/${fileId}/forever`).set("X-CSRF-Token", ownerCsrf);
    expect(res.status).toBe(404);
  });

  it("a stranger gets 404 trying to purge someone else's trashed file", async () => {
    await ownerAgent.delete(`/api/files/${fileId}`).set("X-CSRF-Token", ownerCsrf);

    const res = await strangerAgent.delete(`/api/files/${fileId}/forever`).set("X-CSRF-Token", strangerCsrf);
    expect(res.status).toBe(404);
  });

  it("removes the DB row and unlinks disk bytes once trashed", async () => {
    const paths = storedPathsFor(fileId);
    expect(fs.existsSync(paths.original)).toBe(true);

    const purge = await ownerAgent.delete(`/api/files/${fileId}/forever`).set("X-CSRF-Token", ownerCsrf);
    expect(purge.status).toBe(204);

    expect(fs.existsSync(paths.original)).toBe(false);
    expect(fs.existsSync(paths.thumbnail)).toBe(false);
    expect(fs.existsSync(paths.preview)).toBe(false);
    expect(db.prepare("SELECT COUNT(*) as count FROM files WHERE id = ?").get(fileId).count).toBe(0);
  });
});

describe("trash and shared access", () => {
  let fileId;

  beforeAll(async () => {
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "shared-trash.png");
    await ownerAgent
      .post(`/api/files/${fileId}/shares`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ username: "recipient" });
  });

  it("shows for owner and recipient before trashing", async () => {
    const ownerDl = await ownerAgent.get(`/api/files/${fileId}/download`);
    expect(ownerDl.status).toBe(200);
    const recipientDl = await recipientAgent.get(`/api/files/${fileId}/download`);
    expect(recipientDl.status).toBe(200);

    const shared = await recipientAgent.get("/api/files?scope=shared");
    expect(shared.body.map((f) => f.id)).toContain(fileId);
  });

  it("trashing removes it from download/thumbnail/preview for owner and recipient, and from scope=shared", async () => {
    const del = await ownerAgent.delete(`/api/files/${fileId}`).set("X-CSRF-Token", ownerCsrf);
    expect(del.status).toBe(204);

    const ownerDl = await ownerAgent.get(`/api/files/${fileId}/download`);
    expect(ownerDl.status).toBe(404);
    const recipientDl = await recipientAgent.get(`/api/files/${fileId}/download`);
    expect(recipientDl.status).toBe(404);
    const recipientThumb = await recipientAgent.get(`/api/files/${fileId}/thumbnail`);
    expect(recipientThumb.status).toBe(404);
    const recipientPreview = await recipientAgent.get(`/api/files/${fileId}/preview`);
    expect(recipientPreview.status).toBe(404);

    const shared = await recipientAgent.get("/api/files?scope=shared");
    expect(shared.body.map((f) => f.id)).not.toContain(fileId);
  });

  it("reappears for both owner and recipient after restore", async () => {
    const restore = await ownerAgent.post(`/api/files/${fileId}/restore`).set("X-CSRF-Token", ownerCsrf);
    expect(restore.status).toBe(204);

    const ownerDl = await ownerAgent.get(`/api/files/${fileId}/download`);
    expect(ownerDl.status).toBe(200);
    const recipientDl = await recipientAgent.get(`/api/files/${fileId}/download`);
    expect(recipientDl.status).toBe(200);

    const shared = await recipientAgent.get("/api/files?scope=shared");
    expect(shared.body.map((f) => f.id)).toContain(fileId);
  });
});

describe("purgeExpiredTrash", () => {
  it("only purges rows past retention, leaving a recently-trashed row alone", async () => {
    const { purgeExpiredTrash } = await import("../src/services/uploadService.js");

    const oldFileId = await uploadTestFile(ownerAgent, ownerCsrf, "old-trash.png");
    const recentFileId = await uploadTestFile(ownerAgent, ownerCsrf, "recent-trash.png");

    await ownerAgent.delete(`/api/files/${oldFileId}`).set("X-CSRF-Token", ownerCsrf);
    await ownerAgent.delete(`/api/files/${recentFileId}`).set("X-CSRF-Token", ownerCsrf);

    const oldPaths = storedPathsFor(oldFileId);
    const recentPaths = storedPathsFor(recentFileId);

    // Seed deleted_at far in the past directly, the same technique
    // migration.test.js already uses to hand-shape a row rather than
    // waiting real days for retention to actually elapse.
    const farPast = Math.floor(Date.now() / 1000) - 90 * 86400;
    db.prepare("UPDATE files SET deleted_at = ? WHERE id = ?").run(farPast, oldFileId);

    const purgedCount = await purgeExpiredTrash(30);
    expect(purgedCount).toBe(1);

    expect(db.prepare("SELECT COUNT(*) as count FROM files WHERE id = ?").get(oldFileId).count).toBe(0);
    expect(fs.existsSync(oldPaths.original)).toBe(false);

    expect(db.prepare("SELECT COUNT(*) as count FROM files WHERE id = ?").get(recentFileId).count).toBe(1);
    expect(fs.existsSync(recentPaths.original)).toBe(true);
  });
});
