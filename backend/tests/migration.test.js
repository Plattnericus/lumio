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

  // Same idea for files and device_tokens - shaped like they were before
  // this feature, so the migration has real columns to add rather than
  // schema.sql's CREATE TABLE (which already has them) silently making
  // the ALTER path a no-op.
  seed.exec(`
    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      extension TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      has_thumbnail INTEGER NOT NULL DEFAULT 0,
      uploaded_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  seed
    .prepare(
      `INSERT INTO files (owner_id, original_name, stored_name, mime_type, extension, size_bytes)
       VALUES (1, 'photo.jpg', 'stored1.jpg', 'image/jpeg', 'jpg', 1024)`,
    )
    .run();

  seed.exec(`
    CREATE TABLE device_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at INTEGER
    );
  `);
  seed.prepare("INSERT INTO device_tokens (user_id, token_hash, label) VALUES (1, 'hash-abc', 'watch')").run();

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

describe("files table migration", () => {
  it("adds is_favorite defaulting to 0 and a nullable deleted_at", () => {
    const file = db.prepare("SELECT is_favorite, deleted_at FROM files WHERE stored_name = ?").get("stored1.jpg");
    expect(file).toEqual({ is_favorite: 0, deleted_at: null });
  });

  it("creates the deleted_at and (owner_id, is_favorite) indexes", () => {
    const indexNames = db.prepare("PRAGMA index_list(files)").all().map((idx) => idx.name);
    expect(indexNames).toContain("idx_files_deleted");
    expect(indexNames).toContain("idx_files_favorite");
  });

  it("running the migration again is a no-op", () => {
    // Same shape of check as the role no-op above: mutate a value the
    // migration would only ever set once, then confirm a second run
    // leaves it alone.
    db.prepare("UPDATE files SET is_favorite = 1 WHERE stored_name = ?").run("stored1.jpg");
    migrate();

    const file = db.prepare("SELECT is_favorite FROM files WHERE stored_name = ?").get("stored1.jpg");
    expect(file).toEqual({ is_favorite: 1 });
  });
});

describe("device_tokens table migration", () => {
  it("adds a nullable model column", () => {
    const token = db.prepare("SELECT model FROM device_tokens WHERE token_hash = ?").get("hash-abc");
    expect(token).toEqual({ model: null });
  });

  it("running the migration again is a no-op", () => {
    db.prepare("UPDATE device_tokens SET model = 'fenix7' WHERE token_hash = ?").run("hash-abc");
    migrate();

    const token = db.prepare("SELECT model FROM device_tokens WHERE token_hash = ?").get("hash-abc");
    expect(token).toEqual({ model: "fenix7" });
  });
});
