import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

let db;
let migrate;
let tmpDir;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumio-migration-test-"));
  const dbPath = path.join(tmpDir, "lumio.sqlite");

  // Build a users table shaped like it was before this feature - no
  // role column - to exercise the real upgrade path rather than just
  // trusting schema.sql's CREATE TABLE (which already has the column
  // for any brand new database).
  const seed = new Database(dbPath);
  seed.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  seed.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run("first", "hash1");
  seed.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run("second", "hash2");
  seed.close();

  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
  process.env.DB_PATH = dbPath;
  process.env.UPLOAD_DIR = path.join(tmpDir, "uploads");

  ({ db, migrate } = await import("../src/db/index.js"));
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("users table migration", () => {
  it("adds the role column and promotes the earliest account to admin", () => {
    const users = db.prepare("SELECT username, role FROM users ORDER BY id").all();
    expect(users).toEqual([
      { username: "first", role: "admin" },
      { username: "second", role: "user" },
    ]);
  });

  it("running the migration again is a no-op", () => {
    // The guard is "does the column exist," not "is exactly one admin
    // present" - demote "first" directly and confirm a second run
    // doesn't touch it.
    db.prepare("UPDATE users SET role = 'user' WHERE username = 'first'").run();
    migrate();

    const users = db.prepare("SELECT username, role FROM users ORDER BY id").all();
    expect(users).toEqual([
      { username: "first", role: "user" },
      { username: "second", role: "user" },
    ]);
  });
});
