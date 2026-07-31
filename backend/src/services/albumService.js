import { db } from "../db/index.js";

const insertAlbum = db.prepare("INSERT INTO albums (owner_id, name) VALUES (?, ?) RETURNING *");
const getAlbumForOwner = db.prepare("SELECT * FROM albums WHERE id = ? AND owner_id = ?");
const renameAlbumRow = db.prepare("UPDATE albums SET name = ? WHERE id = ? AND owner_id = ?");
const deleteAlbumRow = db.prepare("DELETE FROM albums WHERE id = ? AND owner_id = ?");

// LEFT JOINs so an empty album still comes back with fileCount 0 rather
// than being dropped, and the second LEFT JOIN's own ON-clause (not a
// WHERE) excludes trashed member files from the count without excluding
// the album row itself - a trashed file shouldn't count towards what the
// user sees as the album's size, matching how it also vanishes from
// scope=album below, but membership itself is untouched either way.
const listAlbumsForOwner = db.prepare(`
  SELECT albums.*, COUNT(files.id) as file_count
  FROM albums
  LEFT JOIN album_files ON album_files.album_id = albums.id
  LEFT JOIN files ON files.id = album_files.file_id AND files.deleted_at IS NULL
  WHERE albums.owner_id = ?
  GROUP BY albums.id
  ORDER BY albums.created_at DESC
`);

// Deliberately no deleted_at filter - ownership of a file for the purpose
// of album membership must hold regardless of trash state, the same way
// toggleFavorite (uploadService.js) ignores trash state. Trashing a file
// never touches album_files, and restoring never needs to either - the
// membership row was never removed in the first place.
const fileOwnedBy = db.prepare("SELECT id FROM files WHERE id = ? AND owner_id = ?");

const addFileRow = db.prepare("INSERT OR IGNORE INTO album_files (album_id, file_id) VALUES (?, ?)");
const removeFileRow = db.prepare("DELETE FROM album_files WHERE album_id = ? AND file_id = ?");

const listAlbumFiles = db.prepare(`
  SELECT files.*
  FROM album_files
  JOIN files ON files.id = album_files.file_id
  WHERE album_files.album_id = ? AND files.deleted_at IS NULL
  ORDER BY album_files.added_at DESC
`);
const listAlbumImages = db.prepare(`
  SELECT files.*
  FROM album_files
  JOIN files ON files.id = album_files.file_id
  WHERE album_files.album_id = ? AND files.deleted_at IS NULL AND files.mime_type LIKE 'image/%'
  ORDER BY album_files.added_at DESC
`);

// Mirrors ShareError exactly - a plain Error subclass used to signal
// "treat as 404" (or 400) upstream, not a real exception. Every
// cross-ownership failure below throws "Not found" so a stranger probing
// someone else's album/file id can't distinguish "doesn't exist" from
// "isn't yours".
export class AlbumError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function requireOwnedAlbum(id, ownerId) {
  const album = getAlbumForOwner.get(id, ownerId);
  if (!album) throw new AlbumError("Not found", 404);
  return album;
}

function requireOwnedFile(fileId, ownerId) {
  const file = fileOwnedBy.get(fileId, ownerId);
  if (!file) throw new AlbumError("Not found", 404);
  return file;
}

export function createAlbum(ownerId, name) {
  return insertAlbum.get(ownerId, name);
}

export function renameAlbum(id, ownerId, name) {
  requireOwnedAlbum(id, ownerId);
  renameAlbumRow.run(name, id, ownerId);
}

// album_files rows cascade automatically (ON DELETE CASCADE on both FKs in
// schema.sql, and db/index.js turns PRAGMA foreign_keys on) - deleting the
// album row is all that's needed here.
export function deleteAlbum(id, ownerId) {
  requireOwnedAlbum(id, ownerId);
  deleteAlbumRow.run(id, ownerId);
}

export function listAlbums(ownerId) {
  return listAlbumsForOwner.all(ownerId).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    fileCount: row.file_count,
  }));
}

// Both ownership checks happen before touching album_files - cross-
// ownership (someone else's album, someone else's file, or both) always
// 404s, never a silent no-op and never a 403 that would confirm the
// album/file exists. INSERT OR IGNORE makes re-adding an already-member
// file idempotent, the same precedent shareService.shareFile already set
// for re-sharing an already-shared user.
export function addFileToAlbum(albumId, fileId, ownerId) {
  requireOwnedAlbum(albumId, ownerId);
  requireOwnedFile(fileId, ownerId);
  addFileRow.run(albumId, fileId);
}

export function removeFileFromAlbum(albumId, fileId, ownerId) {
  requireOwnedAlbum(albumId, ownerId);
  requireOwnedFile(fileId, ownerId);
  removeFileRow.run(albumId, fileId);
}

// Non-exclusive by design (real iCloud/Photos semantics, confirmed with
// the user) - this only ever reads album_files, never removes a file from
// scope=mine, so a file stays in the main library no matter how many
// albums it's also in.
export function listFilesInAlbum(albumId, ownerId, type) {
  requireOwnedAlbum(albumId, ownerId);
  const rows = type === "image" ? listAlbumImages.all(albumId) : listAlbumFiles.all(albumId);
  if (type && type !== "image") {
    return rows.filter((row) => row.extension === type);
  }
  return rows;
}
