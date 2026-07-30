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
const getFileForOwner = db.prepare("SELECT * FROM files WHERE id = ? AND owner_id = ?");
const listFilesForOwner = db.prepare(
  "SELECT * FROM files WHERE owner_id = ? ORDER BY uploaded_at DESC"
);
const listImagesForOwner = db.prepare(
  "SELECT * FROM files WHERE owner_id = ? AND mime_type LIKE 'image/%' ORDER BY uploaded_at DESC"
);
const deleteFileRow = db.prepare("DELETE FROM files WHERE id = ? AND owner_id = ?");

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

export function filePath(file) {
  return path.join(uploadDir, file.stored_name);
}

export function thumbnailPath(file) {
  return path.join(thumbnailDir, `${file.stored_name}.webp`);
}

export function previewPath(file) {
  return path.join(previewDir, `${file.stored_name}.jpg`);
}

export async function deleteFile(id, ownerId) {
  const file = getFileForOwner.get(id, ownerId);
  if (!file) return false;

  deleteFileRow.run(id, ownerId);
  await Promise.all([
    fs.unlink(filePath(file)).catch(() => {}),
    file.has_thumbnail ? fs.unlink(thumbnailPath(file)).catch(() => {}) : Promise.resolve(),
    file.has_thumbnail ? fs.unlink(previewPath(file)).catch(() => {}) : Promise.resolve(),
  ]);
  return true;
}
