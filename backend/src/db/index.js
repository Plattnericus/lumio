import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { env } from "../config/env.js";
import { logger } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

export const db = new Database(env.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// schema.sql is CREATE TABLE IF NOT EXISTS only - fine for brand new
// tables, but it can't add a column to a users table that already
// exists on disk (the real production database has one). This runs
// once, is a no-op on every later boot, and promotes whichever account
// is oldest so an upgrade never leaves a server with zero admins.
export function migrate() {
  const hasRole = db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "role");
  if (!hasRole) {
    db.transaction(() => {
      db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
      db.prepare("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)").run();
    })();
    logger.info("migrated users table: added role, promoted earliest account to admin");
  }

  const hasFavorite = db.prepare("PRAGMA table_info(files)").all().some((c) => c.name === "is_favorite");
  if (!hasFavorite) {
    db.transaction(() => {
      db.exec("ALTER TABLE files ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0");
    })();
    logger.info("migrated files table: added is_favorite");
  }

  const hasDeletedAt = db.prepare("PRAGMA table_info(files)").all().some((c) => c.name === "deleted_at");
  if (!hasDeletedAt) {
    db.transaction(() => {
      db.exec("ALTER TABLE files ADD COLUMN deleted_at INTEGER");
    })();
    logger.info("migrated files table: added deleted_at");
  }

  const hasDeviceModel = db
    .prepare("PRAGMA table_info(device_tokens)")
    .all()
    .some((c) => c.name === "model");
  if (!hasDeviceModel) {
    db.transaction(() => {
      db.exec("ALTER TABLE device_tokens ADD COLUMN model TEXT");
    })();
    logger.info("migrated device_tokens table: added model");
  }

  // Unconditional and outside the guards above: by this point is_favorite
  // and deleted_at exist on every code path, whether from a fresh
  // schema.sql CREATE or the ALTERs just run. These can't live in
  // schema.sql itself - CREATE TABLE IF NOT EXISTS is a no-op against an
  // already-deployed files table, so an index referencing a column that
  // table doesn't have yet would fail with "no such column" on upgrade.
  db.exec("CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(deleted_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_files_favorite ON files(owner_id, is_favorite)");
}
migrate();

db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('auto_update_enabled', 'false')").run();

logger.info({ dbPath: env.dbPath }, "database ready");
