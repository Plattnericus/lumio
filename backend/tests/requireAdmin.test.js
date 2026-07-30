import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db;
let createAccount;
let requireAdmin;
let tmpDir;
let adminId;
let userId;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-require-admin-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "test.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");

  ({ createAccount } = await import("../src/services/authService.js"));
  ({ db } = await import("../src/db/index.js"));
  ({ requireAdmin } = await import("../src/middleware/requireAdmin.js"));

  await createAccount("admin-user", "some-password-1234", "admin");
  await createAccount("plain-user", "some-password-1234", "user");
  adminId = db.prepare("SELECT id FROM users WHERE username = ?").get("admin-user").id;
  userId = db.prepare("SELECT id FROM users WHERE username = ?").get("plain-user").id;
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mockRes() {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe("requireAdmin", () => {
  it("allows a request whose session already has role=admin", () => {
    const req = { session: { role: "admin" } };
    const res = mockRes();
    let nextCalled = false;
    requireAdmin(req, res, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
  });

  it("rejects a request whose session has role=user", () => {
    const req = { session: { role: "user" } };
    const res = mockRes();
    requireAdmin(req, res, () => {});
    expect(res.statusCode).toBe(403);
  });

  it("self-heals a session with no role yet by looking up the user", () => {
    const req = { session: { userId: adminId } };
    const res = mockRes();
    let nextCalled = false;
    requireAdmin(req, res, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
    expect(req.session.role).toBe("admin");
  });

  it("self-heals to a rejection for a non-admin user with no role cached yet", () => {
    const req = { session: { userId: userId } };
    const res = mockRes();
    requireAdmin(req, res, () => {});
    expect(res.statusCode).toBe(403);
    expect(req.session.role).toBe("user");
  });
});
