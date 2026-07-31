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
let ownerId;
let deviceToken;

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

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-garmin-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");

  const { createAccount } = await import("../src/services/authService.js");
  const { createPairingCode, exchangePairingCode } = await import("../src/services/pairingService.js");
  ({ db } = await import("../src/db/index.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();

  await createAccount("owner", PASSWORD);
  ownerId = db.prepare("SELECT id FROM users WHERE username = ?").get("owner").id;

  ownerAgent = request.agent(app);
  const ownerLogin = await ownerAgent.post("/api/auth/login").send({ username: "owner", password: PASSWORD });
  ownerCsrf = ownerLogin.body.csrfToken;

  // Device tokens are only ever minted through the real pairing exchange
  // in production, but calling the service functions directly here is
  // equivalent and avoids re-testing the pairing flow itself (already
  // covered elsewhere) just to get a token for these routes.
  const { code } = createPairingCode(ownerId);
  deviceToken = exchangePairingCode(code);
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/garmin/images", () => {
  it("rejects a missing device token", async () => {
    const res = await request(app).get("/api/garmin/images");
    expect(res.status).toBe(401);
  });

  it("includes the real file name, not just id/uploadedAt", async () => {
    const id = await uploadTestFile(ownerAgent, ownerCsrf, "sunset.png");
    const res = await request(app).get("/api/garmin/images").set("Authorization", `Bearer ${deviceToken}`);
    expect(res.status).toBe(200);
    const entry = res.body.find((row) => row.id === id);
    expect(entry.name).toBe("sunset.png");
  });

  it("filters to favorites via scope=favorites", async () => {
    const favId = await uploadTestFile(ownerAgent, ownerCsrf, "favorited.png");
    await ownerAgent.put(`/api/files/${favId}/favorite`).set("X-CSRF-Token", ownerCsrf).send({ favorite: true });

    const res = await request(app)
      .get("/api/garmin/images")
      .query({ scope: "favorites" })
      .set("Authorization", `Bearer ${deviceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.every((row) => row.id === favId)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("filters to a specific album via scope=album&albumId=", async () => {
    const albumRes = await ownerAgent.post("/api/albums").set("X-CSRF-Token", ownerCsrf).send({ name: "Trip" });
    const albumId = albumRes.body.id;
    const memberId = await uploadTestFile(ownerAgent, ownerCsrf, "trip-photo.png");
    await ownerAgent
      .post(`/api/albums/${albumId}/files`)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ fileId: memberId });

    const res = await request(app)
      .get("/api/garmin/images")
      .query({ scope: "album", albumId })
      .set("Authorization", `Bearer ${deviceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.map((row) => row.id)).toEqual([memberId]);
  });

  it("404s (via AlbumError) for an album that isn't the device's own user", async () => {
    const res = await request(app)
      .get("/api/garmin/images")
      .query({ scope: "album", albumId: 999999 })
      .set("Authorization", `Bearer ${deviceToken}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/garmin/albums", () => {
  it("rejects a missing device token", async () => {
    const res = await request(app).get("/api/garmin/albums");
    expect(res.status).toBe(401);
  });

  it("lists only id/name, no file counts", async () => {
    const res = await request(app).get("/api/garmin/albums").set("Authorization", `Bearer ${deviceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const album of res.body) {
      expect(Object.keys(album).sort()).toEqual(["id", "name"]);
    }
  });
});
