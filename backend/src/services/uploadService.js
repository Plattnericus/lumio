import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { db } from "../db/index.js";
import { env } from "../config/env.js";

// Allow-list keyed by the real, magic-byte-detected mime type - never trust
// the client's declared Content-Type or the file extension. Anything not
// in this map is rejected regardless of what the filename claims to be.
export const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

const THUMBNAIL_WIDTH = 200;
const PREVIEW_WIDTH = 480;

const uploadDir = path.resolve(env.uploadDir);
const thumbnailDir = path.join(uploadDir, "thumbnails");
const previewDir = path.join(uploadDir, "previews");

await fs.mkdir(uploadDir, { recursive: true });
await fs.mkdir(thumbnailDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const insertFile = db.prepare(
  `INSERT INTO files (owner_id, original_name, stored_name, mime_type, extension, size_bytes, has_thumbnail)
   VALUES (@ownerId, @originalName, @storedName, @mimeType, @extension, @sizeBytes, @hasThumbnail)
   RETURNING *`
);
// Every "live file" query below excludes deleted_at IS NOT NULL rows - a
// trashed file must vanish from ownership lookups, listings, downloads,
// everything, until it's restored. listAllOwnedFiles (further down) is the
// deliberate exception, used only by account deletion.
const getFileForOwner = db.prepare("SELECT * FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL");
const listFilesForOwner = db.prepare(
  "SELECT * FROM files WHERE owner_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC"
);
const listImagesForOwner = db.prepare(
  "SELECT * FROM files WHERE owner_id = ? AND mime_type LIKE 'image/%' AND deleted_at IS NULL ORDER BY uploaded_at DESC"
);
const listAllForOwner = db.prepare("SELECT * FROM files WHERE owner_id = ?");

// Owner-only, deliberately no deleted_at filter - toggling favorite must
// keep working on a trashed file so restoring it brings the flag back
// with it, matching real Photos.app behavior (trash and favorite are
// independent states).
const setFavorite = db.prepare("UPDATE files SET is_favorite = ? WHERE id = ? AND owner_id = ?");
const listFavoritesForOwner = db.prepare(
  "SELECT * FROM files WHERE owner_id = ? AND is_favorite = 1 AND deleted_at IS NULL ORDER BY uploaded_at DESC"
);
const listFavoriteImagesForOwner = db.prepare(
  "SELECT * FROM files WHERE owner_id = ? AND mime_type LIKE 'image/%' AND is_favorite = 1 AND deleted_at IS NULL ORDER BY uploaded_at DESC"
);

const softDeleteFile = db.prepare(
  "UPDATE files SET deleted_at = unixepoch() WHERE id = ? AND owner_id = ? AND deleted_at IS NULL"
);
const restoreFileRow = db.prepare(
  "UPDATE files SET deleted_at = NULL WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL"
);
const getTrashedFileForOwner = db.prepare(
  "SELECT * FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL"
);
const purgeFileRow = db.prepare("DELETE FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL");
const listTrashForOwner = db.prepare(
  "SELECT * FROM files WHERE owner_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC"
);
const listTrashImagesForOwner = db.prepare(
  "SELECT * FROM files WHERE owner_id = ? AND mime_type LIKE 'image/%' AND deleted_at IS NOT NULL ORDER BY deleted_at DESC"
);
// System-wide sweep, no owner filter - retentionSeconds is bound as a
// parameter rather than interpolated so retention stays configurable
// without touching the prepared statement itself.
const listExpiredTrash = db.prepare(
  "SELECT * FROM files WHERE deleted_at IS NOT NULL AND deleted_at < unixepoch() - ?"
);
const deleteExpiredTrash = db.prepare(
  "DELETE FROM files WHERE deleted_at IS NOT NULL AND deleted_at < unixepoch() - ?"
);

export class RejectedUploadError extends Error {
  constructor(message) {
    super(message);
    this.status = 415;
  }
}

/**
 * Validates the real file type by magic bytes, persists it under a random
 * name, and generates image renditions where applicable. Throws
 * RejectedUploadError for anything outside the allow-list.
 */
export async function storeUpload({ ownerId, originalName, buffer }) {
  const detected = await fileTypeFromBuffer(buffer);
  const mimeType = detected?.mime;
  const extension = mimeType ? ALLOWED_TYPES[mimeType] : undefined;

  if (!extension) {
    throw new RejectedUploadError(
      "File type not recognized or not allowed. Allowed: jpg, png, webp, pdf, docx, pptx."
    );
  }

  const storedName = `${crypto.randomUUID()}.${extension}`;
  const isImage = mimeType.startsWith("image/");

  await fs.writeFile(path.join(uploadDir, storedName), buffer);

  if (isImage) {
    await sharp(buffer)
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(path.join(thumbnailDir, `${storedName}.webp`));

    await sharp(buffer)
      .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(path.join(previewDir, `${storedName}.jpg`));
  }

  // originalName is display-only - it is never used to build a filesystem
  // path, so a "../../etc/passwd"-style name can't escape the upload dir.
  return insertFile.get({
    ownerId,
    originalName: sanitizeDisplayName(originalName),
    storedName,
    mimeType,
    extension,
    sizeBytes: buffer.length,
    hasThumbnail: isImage ? 1 : 0,
  });
}

function sanitizeDisplayName(name) {
  const base = path.basename(name).replace(/[\r\n]/g, "");
  return base.length > 0 ? base.slice(0, 255) : "upload";
}

export function listFiles(ownerId, type) {
  const rows = type === "image" ? listImagesForOwner.all(ownerId) : listFilesForOwner.all(ownerId);
  if (type && type !== "image") {
    return rows.filter((row) => row.extension === type);
  }
  return rows;
}

export function getFile(id, ownerId) {
  return getFileForOwner.get(id, ownerId);
}

// Owner-only, works regardless of trash state - see setFavorite's comment.
// Returns whether a row was actually updated, so the route can 404 on a
// file that isn't the caller's (or doesn't exist) rather than silently
// succeeding.
export function toggleFavorite(id, ownerId, isFavorite) {
  const result = setFavorite.run(isFavorite ? 1 : 0, id, ownerId);
  return result.changes > 0;
}

export function listFavorites(ownerId, type) {
  const rows = type === "image" ? listFavoriteImagesForOwner.all(ownerId) : listFavoritesForOwner.all(ownerId);
  if (type && type !== "image") {
    return rows.filter((row) => row.extension === type);
  }
  return rows;
}

export function filePath(file) {
  return path.join(uploadDir, file.stored_name);
}

export function thumbnailPath(file) {
  return path.join(thumbnailDir, `${file.stored_name}.webp`);
}

export function previewPath(file) {
  return path.join(previewDir, `${file.stored_name}.jpg`);
}

// Soft delete only - marks the row trashed, never touches disk bytes.
// The route shape (DELETE /api/files/:id -> 204/404) is unchanged, so the
// frontend's existing delete button needs zero changes; what changed is
// that the file is now recoverable via restoreFile until purgeFile (or
// purgeExpiredTrash) actually removes it.
export function deleteFile(id, ownerId) {
  const result = softDeleteFile.run(id, ownerId);
  return result.changes > 0;
}

// Reverses deleteFile - only succeeds while the file is actually trashed.
export function restoreFile(id, ownerId) {
  const result = restoreFileRow.run(id, ownerId);
  return result.changes > 0;
}

// The *old* deleteFile body: unlink original+thumbnail+preview from disk,
// then really delete the row. Gated on the file already being trashed -
// permanent purge is only ever reachable from the trash view.
export async function purgeFile(id, ownerId) {
  const file = getTrashedFileForOwner.get(id, ownerId);
  if (!file) return false;

  purgeFileRow.run(id, ownerId);
  await unlinkFileAssets(file);
  return true;
}

// Disk-unlink logic factored out with no DB write, so callers that already
// have the row (purgeFile, purgeExpiredTrash, deleteUserAndFiles) don't
// each re-derive it.
export async function unlinkFileAssets(file) {
  await Promise.all([
    fs.unlink(filePath(file)).catch(() => {}),
    file.has_thumbnail ? fs.unlink(thumbnailPath(file)).catch(() => {}) : Promise.resolve(),
    file.has_thumbnail ? fs.unlink(previewPath(file)).catch(() => {}) : Promise.resolve(),
  ]);
}

export function listTrash(ownerId, type) {
  const rows = type === "image" ? listTrashImagesForOwner.all(ownerId) : listTrashForOwner.all(ownerId);
  if (type && type !== "image") {
    return rows.filter((row) => row.extension === type);
  }
  return rows;
}

// Every owned file regardless of trash state - deliberately unfiltered by
// deleted_at, unlike listFiles. Exists specifically so deleteUserAndFiles
// can still account for (and unlink the disk bytes of) trashed files too,
// since listFiles would otherwise silently exclude them.
export function listAllOwnedFiles(ownerId) {
  return listAllForOwner.all(ownerId);
}

// System-wide sweep, no owner filter - called from the in-process
// scheduler (lib/trashCleanup.js) and the standalone purge-trash.js
// script. Returns the number of files actually purged.
export async function purgeExpiredTrash(retentionDays) {
  const retentionSeconds = retentionDays * 86400;
  const expired = listExpiredTrash.all(retentionSeconds);
  for (const file of expired) {
    await unlinkFileAssets(file);
  }
  deleteExpiredTrash.run(retentionSeconds);
  return expired.length;
}
