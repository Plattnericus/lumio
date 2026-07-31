import { Router } from "express";
import multer from "multer";
import {
  deleteFile,
  filePath,
  listFavorites,
  listFiles,
  listTrash,
  previewPath,
  purgeFile,
  RejectedUploadError,
  restoreFile,
  storeUpload,
  thumbnailPath,
  toggleFavorite,
} from "../services/uploadService.js";
import {
  getAccessibleFile,
  listFilesSharedWithMe,
  listSharesForFile,
  shareFile,
  ShareError,
  unshareFile,
} from "../services/shareService.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { env } from "../config/env.js";

export const filesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
});

function toPublicFile(file) {
  // A row that came from the shared-with-me join carries owner_username -
  // the scope=mine/favorites/trash paths do no such join, so this is a
  // reliable signal that the row is someone else's file shared with us.
  const isShared = Boolean(file.owner_username);
  return {
    id: file.id,
    originalName: file.original_name,
    mimeType: file.mime_type,
    extension: file.extension,
    sizeBytes: file.size_bytes,
    hasThumbnail: Boolean(file.has_thumbnail),
    uploadedAt: file.uploaded_at,
    // Favorite is owner-only - never present (or toggleable) on a
    // shared-with-me row, the same way sharedBy/sharedAt only ever show up
    // the other direction.
    ...(!isShared ? { isFavorite: Boolean(file.is_favorite) } : {}),
    // Only present for rows that came from the shared-with-me join -
    // the scope=mine path (the common case) does no join at all.
    ...(file.owner_username ? { sharedBy: file.owner_username, sharedAt: file.shared_at } : {}),
    // Only present for trashed rows - a live file's deleted_at is NULL.
    ...(file.deleted_at ? { deletedAt: file.deleted_at } : {}),
  };
}

function handleShareError(err, res, next) {
  if (err instanceof ShareError) {
    return res.status(err.status).json({ error: err.message });
  }
  next(err);
}

filesRouter.use(requireAuth);

filesRouter.get("/", (req, res) => {
  const { scope, type } = req.query;

  if (scope === "shared") {
    return res.json(listFilesSharedWithMe(req.session.userId, type).map(toPublicFile));
  }

  if (scope === "favorites") {
    return res.json(listFavorites(req.session.userId, type).map(toPublicFile));
  }

  if (scope === "trash") {
    // purgeAt is computed here, not baked into SQL - retention is
    // configurable at runtime via env.trashRetentionDays, and the frontend
    // must never hardcode its own copy of that number.
    const files = listTrash(req.session.userId, type).map((file) => {
      const pub = toPublicFile(file);
      return { ...pub, purgeAt: pub.deletedAt + env.trashRetentionDays * 86400 };
    });
    return res.json(files);
  }

  res.json(listFiles(req.session.userId, type).map(toPublicFile));
});

filesRouter.post("/", csrfProtection, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const file = await storeUpload({
      ownerId: req.session.userId,
      originalName: req.file.originalname,
      buffer: req.file.buffer,
    });

    res.status(201).json(toPublicFile(file));
  } catch (err) {
    if (err instanceof RejectedUploadError) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

filesRouter.get("/:id/download", (req, res) => {
  const file = getAccessibleFile(Number(req.params.id), req.session.userId);
  if (!file) return res.status(404).json({ error: "Not found" });

  res.download(filePath(file), file.original_name);
});

filesRouter.get("/:id/thumbnail", (req, res) => {
  const file = getAccessibleFile(Number(req.params.id), req.session.userId);
  if (!file || !file.has_thumbnail) return res.status(404).json({ error: "Not found" });

  res.sendFile(thumbnailPath(file));
});

filesRouter.get("/:id/preview", (req, res) => {
  const file = getAccessibleFile(Number(req.params.id), req.session.userId);
  if (!file || !file.has_thumbnail) return res.status(404).json({ error: "Not found" });

  res.sendFile(previewPath(file));
});

// Delete stays on the strict owner-only getFile/deleteFile - a file
// shared with you is never yours to remove. This is a soft delete (moves
// to trash) - the route shape is unchanged from before trash existed.
filesRouter.delete("/:id", csrfProtection, (req, res) => {
  const deleted = deleteFile(Number(req.params.id), req.session.userId);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// Trash round-trip: restore brings a soft-deleted file back to scope=mine;
// /forever is the only path to an actual, irreversible delete.
filesRouter.post("/:id/restore", csrfProtection, (req, res) => {
  const restored = restoreFile(Number(req.params.id), req.session.userId);
  if (!restored) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

filesRouter.delete("/:id/forever", csrfProtection, async (req, res) => {
  const purged = await purgeFile(Number(req.params.id), req.session.userId);
  if (!purged) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// Owner-only, and deliberately works even while the file is trashed - see
// toggleFavorite's comment in uploadService.js. A trashed favorite is
// still hidden from scope=favorites (and everywhere else) until restored,
// but the flag itself isn't cleared by trashing.
filesRouter.put("/:id/favorite", csrfProtection, (req, res) => {
  const { favorite } = req.body || {};
  if (typeof favorite !== "boolean") {
    return res.status(400).json({ error: "favorite must be a boolean" });
  }

  const updated = toggleFavorite(Number(req.params.id), req.session.userId, favorite);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// Sharing is owner-only in every direction - a file shared with you
// can't be re-shared, and only the owner ever sees who it's shared with.
filesRouter.get("/:id/shares", (req, res, next) => {
  try {
    const shares = listSharesForFile(Number(req.params.id), req.session.userId);
    res.json(shares.map((s) => ({ userId: s.userId, username: s.username })));
  } catch (err) {
    handleShareError(err, res, next);
  }
});

filesRouter.post("/:id/shares", csrfProtection, (req, res, next) => {
  try {
    const { username } = req.body || {};
    if (typeof username !== "string" || username.trim().length === 0) {
      return res.status(400).json({ error: "Username is required" });
    }
    shareFile(Number(req.params.id), req.session.userId, username);
    res.status(201).json({ ok: true });
  } catch (err) {
    handleShareError(err, res, next);
  }
});

filesRouter.delete("/:id/shares/:userId", csrfProtection, (req, res, next) => {
  try {
    unshareFile(Number(req.params.id), req.session.userId, Number(req.params.userId));
    res.status(204).end();
  } catch (err) {
    handleShareError(err, res, next);
  }
});

// Multer throws before our route handler runs on oversized files - surface
// that as a clean 413 instead of a generic 500.
filesRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File exceeds the ${env.maxUploadMb}MB limit` });
  }
  next(err);
});
