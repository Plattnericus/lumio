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
let strangerAgent;
let strangerCsrf;

const PASSWORD = "correct-horse-battery";

async function uploadTestFile(agent, csrf, name) {
  const png = await sharp({
    create: { width: 6, height: 6, channels: 3, background: { r: 7, g: 7, b: 7 } },
  })
    .png()
    .toBuffer();
  const res = await agent.post("/api/files").set("X-CSRF-Token", csrf).attach("file", png, name);
  return res.body.id;
}

async function createTestAlbum(agent, csrf, name) {
  const res = await agent.post("/api/albums").set("X-CSRF-Token", csrf).send({ name });
  return res.body.id;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-albums-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");

  const { createAccount } = await import("../src/services/authService.js");
  ({ db } = await import("../src/db/index.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();

  await createAccount("owner", PASSWORD);
  await createAccount("stranger", PASSWORD);

  ownerAgent = request.agent(app);
  const ownerLogin = await ownerAgent.post("/api/auth/login").send({ username: "owner", password: PASSWORD });
  ownerCsrf = ownerLogin.body.csrfToken;

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

describe("album CRUD", () => {
  it("rejects an empty name", async () => {
    const res = await ownerAgent.post("/api/albums").set("X-CSRF-Token", ownerCsrf).send({ name: "  " });
    expect(res.status).toBe(400);
  });

  it("creates an album", async () => {
    const res = await ownerAgent.post("/api/albums").set("X-CSRF-Token", ownerCsrf).send({ name: "Vacation" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Vacation");
    expect(res.body.fileCount).toBe(0);
  });

  it("lists albums for the owner", async () => {
    const res = await ownerAgent.get("/api/albums");
    expect(res.status).toBe(200);
    expect(res.body.map((a) => a.name)).toContain("Vacation");
  });

  it("renames an album", async () => {
    const albumId = await createTestAlbum(ownerAgent, ownerCsrf, "Old Name");
    const rename = await ownerAgent
      .put(`/api/albums/${albumId}`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ name: "New Name" });
    expect(rename.status).toBe(204);

    const list = await ownerAgent.get("/api/albums");
    expect(list.body.find((a) => a.id === albumId).name).toBe("New Name");
  });

  it("deletes an album", async () => {
    const albumId = await createTestAlbum(ownerAgent, ownerCsrf, "Temp");
    const del = await ownerAgent.delete(`/api/albums/${albumId}`).set("X-CSRF-Token", ownerCsrf);
    expect(del.status).toBe(204);

    const list = await ownerAgent.get("/api/albums");
    expect(list.body.map((a) => a.id)).not.toContain(albumId);
  });
});

describe("cross-user 404s on every album/membership operation", () => {
  let albumId;
  let fileId;

  beforeAll(async () => {
    albumId = await createTestAlbum(ownerAgent, ownerCsrf, "Owner's Album");
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "owner-file.png");
  });

  it("a stranger gets 404 (not 403) renaming someone else's album", async () => {
    const res = await strangerAgent
      .put(`/api/albums/${albumId}`)
      .set("X-CSRF-Token", strangerCsrf)
      .send({ name: "Hijacked" });
    expect(res.status).toBe(404);
  });

  it("a stranger gets 404 deleting someone else's album", async () => {
    const res = await strangerAgent.delete(`/api/albums/${albumId}`).set("X-CSRF-Token", strangerCsrf);
    expect(res.status).toBe(404);
  });

  it("a stranger gets 404 adding their own file to someone else's album", async () => {
    const strangerFileId = await uploadTestFile(strangerAgent, strangerCsrf, "stranger-file.png");
    const res = await strangerAgent
      .post(`/api/albums/${albumId}/files`)
      .set("X-CSRF-Token", strangerCsrf)
      .send({ fileId: strangerFileId });
    expect(res.status).toBe(404);
  });

  it("a stranger gets 404 trying to add someone else's file to their own album", async () => {
    const strangerAlbumId = await createTestAlbum(strangerAgent, strangerCsrf, "Stranger's Album");
    const res = await strangerAgent
      .post(`/api/albums/${strangerAlbumId}/files`)
      .set("X-CSRF-Token", strangerCsrf)
      .send({ fileId });
    expect(res.status).toBe(404);
  });

  it("a stranger gets 404 removing a file from someone else's album", async () => {
    await ownerAgent
      .post(`/api/albums/${albumId}/files`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ fileId });
    const res = await strangerAgent
      .delete(`/api/albums/${albumId}/files/${fileId}`)
      .set("X-CSRF-Token", strangerCsrf);
    expect(res.status).toBe(404);
  });

  it("a stranger gets 404 browsing scope=album for someone else's album", async () => {
    const res = await strangerAgent.get(`/api/files?scope=album&albumId=${albumId}`);
    expect(res.status).toBe(404);
  });
});

describe("non-exclusivity: a file in an album still shows in scope=mine", () => {
  let albumId;
  let fileId;

  beforeAll(async () => {
    albumId = await createTestAlbum(ownerAgent, ownerCsrf, "Non-exclusive");
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "non-exclusive.png");
    const add = await ownerAgent
      .post(`/api/albums/${albumId}/files`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ fileId });
    expect(add.status).toBe(201);
  });

  it("shows up under scope=album", async () => {
    const res = await ownerAgent.get(`/api/files?scope=album&albumId=${albumId}`);
    expect(res.status).toBe(200);
    expect(res.body.map((f) => f.id)).toContain(fileId);
  });

  it("still shows up under scope=mine", async () => {
    const res = await ownerAgent.get("/api/files?scope=mine");
    expect(res.body.map((f) => f.id)).toContain(fileId);
  });

  it("bumps the album's fileCount", async () => {
    const res = await ownerAgent.get("/api/albums");
    expect(res.body.find((a) => a.id === albumId).fileCount).toBe(1);
  });

  it("re-adding the same file is an idempotent no-op", async () => {
    const res = await ownerAgent
      .post(`/api/albums/${albumId}/files`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ fileId });
    expect(res.status).toBe(201);
    expect(
      db.prepare("SELECT COUNT(*) as count FROM album_files WHERE album_id = ? AND file_id = ?").get(albumId, fileId)
        .count
    ).toBe(1);
  });

  it("removing it drops it from scope=album but not scope=mine", async () => {
    const remove = await ownerAgent
      .delete(`/api/albums/${albumId}/files/${fileId}`)
      .set("X-CSRF-Token", ownerCsrf);
    expect(remove.status).toBe(204);

    const album = await ownerAgent.get(`/api/files?scope=album&albumId=${albumId}`);
    expect(album.body.map((f) => f.id)).not.toContain(fileId);

    const mine = await ownerAgent.get("/api/files?scope=mine");
    expect(mine.body.map((f) => f.id)).toContain(fileId);
  });
});

describe("trash/restore interaction", () => {
  let albumId;
  let fileId;

  beforeAll(async () => {
    albumId = await createTestAlbum(ownerAgent, ownerCsrf, "Trash Interaction");
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "trash-interaction.png");
    const add = await ownerAgent
      .post(`/api/albums/${albumId}/files`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ fileId });
    expect(add.status).toBe(201);
  });

  it("disappears from scope=album once trashed, and the album's fileCount drops", async () => {
    const del = await ownerAgent.delete(`/api/files/${fileId}`).set("X-CSRF-Token", ownerCsrf);
    expect(del.status).toBe(204);

    const album = await ownerAgent.get(`/api/files?scope=album&albumId=${albumId}`);
    expect(album.body.map((f) => f.id)).not.toContain(fileId);

    const albums = await ownerAgent.get("/api/albums");
    expect(albums.body.find((a) => a.id === albumId).fileCount).toBe(0);
  });

  it("membership itself survives the trash round trip - the row is still there in the DB", async () => {
    const row = db
      .prepare("SELECT COUNT(*) as count FROM album_files WHERE album_id = ? AND file_id = ?")
      .get(albumId, fileId);
    expect(row.count).toBe(1);
  });

  it("album/file membership operations still work while the file is trashed", async () => {
    const remove = await ownerAgent
      .delete(`/api/albums/${albumId}/files/${fileId}`)
      .set("X-CSRF-Token", ownerCsrf);
    expect(remove.status).toBe(204);

    const readd = await ownerAgent
      .post(`/api/albums/${albumId}/files`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ fileId });
    expect(readd.status).toBe(201);
  });

  it("reappears under scope=album, and fileCount recovers, after restore", async () => {
    const restore = await ownerAgent.post(`/api/files/${fileId}/restore`).set("X-CSRF-Token", ownerCsrf);
    expect(restore.status).toBe(204);

    const album = await ownerAgent.get(`/api/files?scope=album&albumId=${albumId}`);
    expect(album.body.map((f) => f.id)).toContain(fileId);

    const albums = await ownerAgent.get("/api/albums");
    expect(albums.body.find((a) => a.id === albumId).fileCount).toBe(1);
  });
});

describe("deleting an album cascades album_files but leaves the file alone", () => {
  it("removes the membership row and the file still shows in scope=mine", async () => {
    const albumId = await createTestAlbum(ownerAgent, ownerCsrf, "To Be Deleted");
    const fileId = await uploadTestFile(ownerAgent, ownerCsrf, "cascade.png");
    await ownerAgent.post(`/api/albums/${albumId}/files`).set("X-CSRF-Token", ownerCsrf).send({ fileId });

    const del = await ownerAgent.delete(`/api/albums/${albumId}`).set("X-CSRF-Token", ownerCsrf);
    expect(del.status).toBe(204);

    expect(db.prepare("SELECT COUNT(*) as count FROM album_files WHERE album_id = ?").get(albumId).count).toBe(0);

    const mine = await ownerAgent.get("/api/files?scope=mine");
    expect(mine.body.map((f) => f.id)).toContain(fileId);
  });
});
