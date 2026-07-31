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
    create: { width: 6, height: 6, channels: 3, background: { r: 5, g: 5, b: 5 } },
  })
    .png()
    .toBuffer();
  const res = await agent.post("/api/files").set("X-CSRF-Token", csrf).attach("file", png, name);
  return res.body.id;
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-favorites-test-"));
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

describe("toggling favorite", () => {
  let fileId;

  beforeAll(async () => {
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "toggle.png");
  });

  it("is false by default", async () => {
    const res = await ownerAgent.get("/api/files?scope=mine");
    const file = res.body.find((f) => f.id === fileId);
    expect(file.isFavorite).toBe(false);
  });

  it("rejects a non-boolean body", async () => {
    const res = await ownerAgent
      .put(`/api/files/${fileId}/favorite`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ favorite: "yes" });
    expect(res.status).toBe(400);
  });

  it("turns favorite on", async () => {
    const res = await ownerAgent
      .put(`/api/files/${fileId}/favorite`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ favorite: true });
    expect(res.status).toBe(204);

    const mine = await ownerAgent.get("/api/files?scope=mine");
    expect(mine.body.find((f) => f.id === fileId).isFavorite).toBe(true);
  });

  it("shows up under scope=favorites", async () => {
    const res = await ownerAgent.get("/api/files?scope=favorites");
    expect(res.body.map((f) => f.id)).toContain(fileId);
  });

  it("turns favorite back off", async () => {
    const res = await ownerAgent
      .put(`/api/files/${fileId}/favorite`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ favorite: false });
    expect(res.status).toBe(204);

    const mine = await ownerAgent.get("/api/files?scope=mine");
    expect(mine.body.find((f) => f.id === fileId).isFavorite).toBe(false);

    const favorites = await ownerAgent.get("/api/files?scope=favorites");
    expect(favorites.body.map((f) => f.id)).not.toContain(fileId);
  });
});

describe("cross-user access", () => {
  let fileId;

  beforeAll(async () => {
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "cross-user.png");
  });

  it("a stranger gets 404 trying to favorite someone else's file", async () => {
    const res = await strangerAgent
      .put(`/api/files/${fileId}/favorite`)
      .set("X-CSRF-Token", strangerCsrf)
      .send({ favorite: true });
    expect(res.status).toBe(404);

    const row = db.prepare("SELECT is_favorite FROM files WHERE id = ?").get(fileId);
    expect(row.is_favorite).toBe(0);
  });

  it("404s on a nonexistent file id", async () => {
    const res = await ownerAgent
      .put("/api/files/999999/favorite")
      .set("X-CSRF-Token", ownerCsrf)
      .send({ favorite: true });
    expect(res.status).toBe(404);
  });
});

describe("favorite survives trash and restore", () => {
  let fileId;

  beforeAll(async () => {
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "trash-survive.png");
    const fav = await ownerAgent
      .put(`/api/files/${fileId}/favorite`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ favorite: true });
    expect(fav.status).toBe(204);
  });

  it("toggling favorite still works while trashed", async () => {
    const del = await ownerAgent.delete(`/api/files/${fileId}`).set("X-CSRF-Token", ownerCsrf);
    expect(del.status).toBe(204);

    // The flag is already on; toggling it off and back on again must still
    // succeed even though the file is currently in the trash.
    const off = await ownerAgent
      .put(`/api/files/${fileId}/favorite`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ favorite: false });
    expect(off.status).toBe(204);

    const on = await ownerAgent
      .put(`/api/files/${fileId}/favorite`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ favorite: true });
    expect(on.status).toBe(204);
  });

  it("is excluded from scope=favorites while trashed, even though the flag is set", async () => {
    const favorites = await ownerAgent.get("/api/files?scope=favorites");
    expect(favorites.body.map((f) => f.id)).not.toContain(fileId);

    const row = db.prepare("SELECT is_favorite FROM files WHERE id = ?").get(fileId);
    expect(row.is_favorite).toBe(1);
  });

  it("reappears under scope=favorites, still favorited, after restore", async () => {
    const restore = await ownerAgent.post(`/api/files/${fileId}/restore`).set("X-CSRF-Token", ownerCsrf);
    expect(restore.status).toBe(204);

    const favorites = await ownerAgent.get("/api/files?scope=favorites");
    const restored = favorites.body.find((f) => f.id === fileId);
    expect(restored).toBeTruthy();
    expect(restored.isFavorite).toBe(true);
  });
});

describe("favorite is absent and not toggleable via shared-with-me", () => {
  let fileId;

  beforeAll(async () => {
    fileId = await uploadTestFile(ownerAgent, ownerCsrf, "shared-favorite.png");
    await ownerAgent
      .put(`/api/files/${fileId}/favorite`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ favorite: true });
    await ownerAgent
      .post(`/api/files/${fileId}/shares`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ username: "recipient" });
  });

  it("isFavorite is not present on the shared-with-me row", async () => {
    const res = await recipientAgent.get("/api/files?scope=shared");
    const shared = res.body.find((f) => f.id === fileId);
    expect(shared).toBeTruthy();
    expect(shared).not.toHaveProperty("isFavorite");
  });

  it("the recipient cannot toggle favorite on a file that isn't theirs", async () => {
    const res = await recipientAgent
      .put(`/api/files/${fileId}/favorite`)
      .set("X-CSRF-Token", recipientCsrf)
      .send({ favorite: true });
    expect(res.status).toBe(404);
  });

  it("the owner still sees isFavorite true under scope=mine", async () => {
    const res = await ownerAgent.get("/api/files?scope=mine");
    expect(res.body.find((f) => f.id === fileId).isFavorite).toBe(true);
  });
});
