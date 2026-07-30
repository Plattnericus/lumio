import { Router } from "express";
import multer from "multer";
import {
  deleteFile,
  filePath,
  getFile,
  listFiles,
  previewPath,
  RejectedUploadError,
  storeUpload,
  thumbnailPath,
} from "../services/uploadService.js";
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
  };
}

filesRouter.use(requireAuth);

filesRouter.get("/", (req, res) => {
  const files = listFiles(req.session.userId, req.query.type);
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
  const file = getFile(Number(req.params.id), req.session.userId);
  if (!file) return res.status(404).json({ error: "Not found" });

  res.download(filePath(file), file.original_name);
});

filesRouter.get("/:id/thumbnail", (req, res) => {
  const file = getFile(Number(req.params.id), req.session.userId);
  if (!file || !file.has_thumbnail) return res.status(404).json({ error: "Not found" });

  res.sendFile(thumbnailPath(file));
});

filesRouter.get("/:id/preview", (req, res) => {
  const file = getFile(Number(req.params.id), req.session.userId);
  if (!file || !file.has_thumbnail) return res.status(404).json({ error: "Not found" });

  res.sendFile(previewPath(file));
});

filesRouter.delete("/:id", csrfProtection, async (req, res) => {
  const deleted = await deleteFile(Number(req.params.id), req.session.userId);
  if (!deleted) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

// Multer throws before our route handler runs on oversized files - surface
// that as a clean 413 instead of a generic 500.
filesRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File exceeds the ${env.maxUploadMb}MB limit` });
  }
  next(err);
});
