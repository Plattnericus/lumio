import { Router } from "express";
import multer from "multer";
import {
  deleteFile,
  filePath,
  listFiles,
  previewPath,
  RejectedUploadError,
  storeUpload,
  thumbnailPath,
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
  return {
    id: file.id,
    originalName: file.original_name,
    mimeType: file.mime_type,
    extension: file.extension,
    sizeBytes: file.size_bytes,
    hasThumbnail: Boolean(file.has_thumbnail),
    uploadedAt: file.uploaded_at,
    // Only present for rows that came from the shared-with-me join -
    // the scope=mine path (the common case) does no join at all.
    ...(file.owner_username ? { sharedBy: file.owner_username, sharedAt: file.shared_at } : {}),
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
  const files =
    req.query.scope === "shared"
      ? listFilesSharedWithMe(req.session.userId, req.query.type)
      : listFiles(req.session.userId, req.query.type);
  res.json(files.map(toPublicFile));
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
// shared with you is never yours to remove.
filesRouter.delete("/:id", csrfProtection, async (req, res) => {
  const deleted = await deleteFile(Number(req.params.id), req.session.userId);
  if (!deleted) return res.status(404).json({ error: "Not found" });
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
