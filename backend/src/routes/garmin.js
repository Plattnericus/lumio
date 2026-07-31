import { Router } from "express";
import { getFile, listFavorites, listFiles, previewPath } from "../services/uploadService.js";
import { listAlbums, listFilesInAlbum, AlbumError } from "../services/albumService.js";
import { requireDeviceToken } from "../middleware/requireDeviceToken.js";

export const garminRouter = Router();

garminRouter.use(requireDeviceToken);

// name is included (not just id/uploadedAt) so the watch can show the
// real filename instead of a bare "Photo <id>" label - still no
// thumbnails in this payload, a name string is a few bytes, not worth a
// second round-trip over. scope=favorites/albumId mirror the web API's
// GET /api/files dispatch, always still image-only and deleted_at-excluded
// (listFiles/listFavorites/listFilesInAlbum all already enforce that).
garminRouter.get("/images", (req, res, next) => {
  try {
    const { scope, albumId } = req.query;
    let files;
    if (scope === "favorites") {
      files = listFavorites(req.deviceUserId, "image");
    } else if (scope === "album") {
      files = listFilesInAlbum(Number(albumId), req.deviceUserId, "image");
    } else {
      files = listFiles(req.deviceUserId, "image");
    }

    const images = files.map((file) => ({
      id: file.id,
      name: file.original_name,
      uploadedAt: file.uploaded_at,
    }));
    res.json(images);
  } catch (err) {
    if (err instanceof AlbumError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Minimal payload for the watch's filter menu - just enough to list and
// pick an album, not the file counts the web UI shows.
garminRouter.get("/albums", (req, res) => {
  const albums = listAlbums(req.deviceUserId).map((album) => ({
    id: album.id,
    name: album.name,
  }));
  res.json(albums);
});

// Fullscreen view: serves the pre-resized preview rendition, not the
// original - a multi-megapixel photo has no business going over
// Bluetooth to a watch.
garminRouter.get("/images/:id", (req, res) => {
  const file = getFile(Number(req.params.id), req.deviceUserId);
  if (!file || !file.has_thumbnail) return res.status(404).json({ error: "Not found" });

  res.sendFile(previewPath(file));
});
