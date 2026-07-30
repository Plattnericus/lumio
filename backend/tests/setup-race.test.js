import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// In its own file deliberately: this needs a completely fresh module
// registry so authService.js's own `import { db }` binds to this file's
// database rather than whatever another test file already cached for
// the plain "../src/db/index.js" specifier.

let db;
let createInitialAdminAccount;
let tmpDir;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-setup-race-test-"));
  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = path.join(tmpDir, "race.sqlite");
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");

  ({ db } = await import("../src/db/index.js"));
  ({ createInitialAdminAccount } = await import("../src/services/authService.js"));
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createInitialAdminAccount concurrency", () => {
  it("only lets one of two concurrent calls create the account", async () => {
    // The whole point of the test: fire both before either has finished.
    // Race-safety comes from never awaiting between the count check and
    // the insert inside createAdminIfNoneExists, not from anything here.
    const [first, second] = await Promise.all([
      createInitialAdminAccount("racer-a", "correct-horse-battery"),
      createInitialAdminAccount("racer-b", "correct-horse-battery"),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) as count FROM users").get().count).toBe(1);
  });
});
