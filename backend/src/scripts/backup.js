import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "../config/env.js";

// A plain file copy of a WAL-mode SQLite database isn't guaranteed
// consistent while the app is running - better-sqlite3's backup() uses
// SQLite's own online backup API instead, safe against concurrent writes.

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(env.dbPath), "backups");
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 7);

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function rotate() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(BACKUP_DIR)) {
    const fullPath = path.join(BACKUP_DIR, entry);
    if (fs.statSync(fullPath).mtimeMs < cutoff) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`Removed backup older than ${RETENTION_DAYS} days: ${entry}`);
    }
  }
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = timestamp();

  const db = new Database(env.dbPath, { readonly: true });
  const dbBackupPath = path.join(BACKUP_DIR, `lumio-${stamp}.sqlite`);
  await db.backup(dbBackupPath);
  db.close();

  const uploadsBackupPath = path.join(BACKUP_DIR, `uploads-${stamp}`);
  fs.cpSync(env.uploadDir, uploadsBackupPath, { recursive: true });

  console.log(`Backup written: ${dbBackupPath}`);
  console.log(`Backup written: ${uploadsBackupPath}`);

  rotate();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
