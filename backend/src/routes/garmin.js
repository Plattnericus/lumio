import { Router } from "express";
import { getFile, listFiles, previewPath } from "../services/uploadService.js";
import { requireDeviceToken } from "../middleware/requireDeviceToken.js";

export const garminRouter = Router();

garminRouter.use(requireDeviceToken);

// Minimal payload - the watch renders this as a plain list, no thumbnails.
garminRouter.get("/images", (req, res) => {
  const images = listFiles(req.deviceUserId, "image").map((file) => ({
    id: file.id,
    uploadedAt: file.uploaded_at,
  }));
  res.json(images);
});

// Fullscreen view: serves the pre-resized preview rendition, not the
// original - a multi-megapixel photo has no business going over
// Bluetooth to a watch.
garminRouter.get("/images/:id", (req, res) => {
  const file = getFile(Number(req.params.id), req.deviceUserId);
  if (!file || !file.has_thumbnail) return res.status(404).json({ error: "Not found" });

  res.sendFile(previewPath(file));
});
