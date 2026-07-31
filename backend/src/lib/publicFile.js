// Shared files-table-row -> API-shape mapper, extracted out of files.js
// once a second scope (scope=album) needed the exact same mapping as
// scope=mine/favorites/trash. Garmin's /api/garmin/images intentionally
// returns a much smaller { id, uploadedAt } payload (see routes/garmin.js)
// for bandwidth reasons - that's a real, documented shape divergence, not
// duplicated logic, so it isn't consolidated into this mapper.
export function toPublicFile(file) {
  // A row that came from the shared-with-me join carries owner_username -
  // scope=mine/favorites/trash/album do no such join, so this is a
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
