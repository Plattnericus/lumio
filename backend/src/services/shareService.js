import { db } from "../db/index.js";
import { findUserByUsername } from "./authService.js";
import { getFile } from "./uploadService.js";

const insertShare = db.prepare(
  "INSERT OR IGNORE INTO file_shares (file_id, shared_with_user_id, shared_by_user_id) VALUES (?, ?, ?)"
);
const deleteShare = db.prepare(
  "DELETE FROM file_shares WHERE file_id = ? AND shared_with_user_id = ?"
);
const sharesForFile = db.prepare(`
  SELECT users.id as userId, users.username
  FROM file_shares
  JOIN users ON users.id = file_shares.shared_with_user_id
  WHERE file_shares.file_id = ?
  ORDER BY file_shares.created_at
`);
// Both queries below add "files.deleted_at IS NULL" - this is what makes a
// trashed file vanish from every access path (owner and recipient alike)
// and from "shared with me" until it's restored.
const sharedWithMe = db.prepare(`
  SELECT files.*, owner.username as owner_username, file_shares.created_at as shared_at
  FROM files
  JOIN file_shares ON file_shares.file_id = files.id
  JOIN users owner ON owner.id = files.owner_id
  WHERE file_shares.shared_with_user_id = ? AND files.deleted_at IS NULL
  ORDER BY file_shares.created_at DESC
`);
const accessibleFile = db.prepare(`
  SELECT * FROM files
  WHERE id = ? AND deleted_at IS NULL AND (
    owner_id = ?
    OR EXISTS (SELECT 1 FROM file_shares WHERE file_id = files.id AND shared_with_user_id = ?)
  )
`);

export class ShareError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Existence and ownership are confirmed in one call via getFile - the
// same 404-not-403 pattern the rest of this codebase uses for "not yours"
// vs "doesn't exist" (never tell a caller which one it is).
export function shareFile(fileId, ownerId, targetUsername) {
  const file = getFile(fileId, ownerId);
  if (!file) throw new ShareError("Not found", 404);

  const target = findUserByUsername(targetUsername);
  if (!target) throw new ShareError("User not found", 404);
  if (target.id === ownerId) throw new ShareError("Cannot share a file with yourself", 400);

  // Re-sharing an already-shared user is a no-op, not an error.
  insertShare.run(fileId, target.id, ownerId);
}

export function unshareFile(fileId, ownerId, targetUserId) {
  const file = getFile(fileId, ownerId);
  if (!file) throw new ShareError("Not found", 404);
  deleteShare.run(fileId, targetUserId);
}

export function listSharesForFile(fileId, ownerId) {
  const file = getFile(fileId, ownerId);
  if (!file) throw new ShareError("Not found", 404);
  return sharesForFile.all(fileId);
}

export function listFilesSharedWithMe(userId, type) {
  const rows = sharedWithMe.all(userId);
  if (type === "image") return rows.filter((row) => row.mime_type.startsWith("image/"));
  if (type) return rows.filter((row) => row.extension === type);
  return rows;
}

export function getAccessibleFile(fileId, userId) {
  return accessibleFile.get(fileId, userId, userId);
}
