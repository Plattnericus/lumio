import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";

let app;
let tmpDir;
let db;
let adminAgent;
let adminCsrf;
let userAgent;
let userCsrf;

const ADMIN_PASSWORD = "correct-horse-battery";
const USER_PASSWORD = "correct-horse-battery";

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-admin-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");

  const { createAccount } = await import("../src/services/authService.js");
  ({ db } = await import("../src/db/index.js"));
  const { createApp } = await import("../src/app.js");
  app = createApp();

  await createAccount("admin-user", ADMIN_PASSWORD, "admin");
  await createAccount("plain-user", USER_PASSWORD, "user");

  adminAgent = request.agent(app);
  const adminLogin = await adminAgent
    .post("/api/auth/login")
    .send({ username: "admin-user", password: ADMIN_PASSWORD });
  adminCsrf = adminLogin.body.csrfToken;

  userAgent = request.agent(app);
  const userLogin = await userAgent
    .post("/api/auth/login")
    .send({ username: "plain-user", password: USER_PASSWORD });
  userCsrf = userLogin.body.csrfToken;
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/admin/users", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin user", async () => {
    const res = await userAgent.get("/api/admin/users");
    expect(res.status).toBe(403);
  });

  it("lists users for an admin, without password hashes", async () => {
    const res = await adminAgent.get("/api/admin/users");
    expect(res.status).toBe(200);
    const usernames = res.body.map((u) => u.username);
    expect(usernames).toEqual(expect.arrayContaining(["admin-user", "plain-user"]));
    expect(res.body.every((u) => !("password_hash" in u) && !("passwordHash" in u))).toBe(true);
  });
});

describe("POST /api/admin/users", () => {
  it("rejects a non-admin", async () => {
    const res = await userAgent
      .post("/api/admin/users")
      .set("X-CSRF-Token", userCsrf)
      .send({ username: "should-not-exist", password: "correct-horse-battery" });
    expect(res.status).toBe(403);
  });

  it("creates a new account with role=user", async () => {
    const res = await adminAgent
      .post("/api/admin/users")
      .set("X-CSRF-Token", adminCsrf)
      .send({ username: "new-user", password: "correct-horse-battery" });

    expect(res.status).toBe(201);

    const created = db.prepare("SELECT role FROM users WHERE username = ?").get("new-user");
    expect(created.role).toBe("user");
  });

  it("rejects a duplicate username with 409, not 500", async () => {
    const res = await adminAgent
      .post("/api/admin/users")
      .set("X-CSRF-Token", adminCsrf)
      .send({ username: "new-user", password: "correct-horse-battery" });

    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/admin/users/:id", () => {
  it("rejects a non-admin", async () => {
    const res = await userAgent.delete("/api/admin/users/1").set("X-CSRF-Token", userCsrf);
    expect(res.status).toBe(403);
  });

  it("removes the user's on-disk files, not just the database row", async () => {
    // A dedicated throwaway account with one real uploaded file.
    const { createAccount } = await import("../src/services/authService.js");
    await createAccount("to-delete", "correct-horse-battery", "user");

    const deleteAgent = request.agent(app);
    const login = await deleteAgent
      .post("/api/auth/login")
      .send({ username: "to-delete", password: "correct-horse-battery" });

    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .png()
      .toBuffer();

    const upload = await deleteAgent
      .post("/api/files")
      .set("X-CSRF-Token", login.body.csrfToken)
      .attach("file", png, "photo.png");
    expect(upload.status).toBe(201);

    const storedName = db.prepare("SELECT stored_name FROM files WHERE id = ?").get(upload.body.id).stored_name;
    const filePath = path.join(tmpDir, "uploads", storedName);
    expect(fs.existsSync(filePath)).toBe(true);

    const userId = db.prepare("SELECT id FROM users WHERE username = ?").get("to-delete").id;
    const del = await adminAgent.delete(`/api/admin/users/${userId}`).set("X-CSRF-Token", adminCsrf);
    expect(del.status).toBe(204);

    expect(db.prepare("SELECT COUNT(*) as count FROM users WHERE id = ?").get(userId).count).toBe(0);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("refuses to delete your own account", async () => {
    const adminId = db.prepare("SELECT id FROM users WHERE username = ?").get("admin-user").id;
    const res = await adminAgent.delete(`/api/admin/users/${adminId}`).set("X-CSRF-Token", adminCsrf);
    expect(res.status).toBe(400);
  });

  it("isLastAdmin correctly tracks the admin count", async () => {
    // Admin-creates-admin doesn't exist in this version (admin-created
    // accounts are always role:"user"), so with only ever one admin
    // reachable via the API, X trying to delete Y where Y is the last
    // admin and X != Y can't happen through this route - if X is admin
    // (required to pass requireAdmin) and Y is the sole admin, X and Y
    // are the same account, which the self-delete check above already
    // catches first. Testing the guard function directly instead of
    // pretending there's an HTTP path that exercises it: seed a second
    // admin by hand (simulating the one way this could ever happen -
    // direct DB access, same as the CLI script's disaster-recovery
    // path), confirm neither is "last" while both exist, then confirm
    // the guard flips once only one remains.
    const { isLastAdmin } = await import("../src/services/authService.js");
    const adminId = db.prepare("SELECT id FROM users WHERE username = ?").get("admin-user").id;

    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
      "second-admin",
      "not-a-real-hash"
    );
    const secondAdminId = db.prepare("SELECT id FROM users WHERE username = ?").get("second-admin").id;

    expect(isLastAdmin(adminId)).toBe(false);
    expect(isLastAdmin(secondAdminId)).toBe(false);

    db.prepare("DELETE FROM users WHERE id = ?").run(secondAdminId);
    expect(isLastAdmin(adminId)).toBe(true);
  });
});
