import { api, downloadUrl, previewUrl, thumbnailUrl, uploadFile } from "./api.js";
import { wirePasswordToggles } from "./setup.js";
import { groupFilesByDate } from "./gridGrouping.js";
import { cycleTheme, getTheme } from "./theme.js";
import {
  iconAlbum,
  iconAuto,
  iconBrand,
  iconChevronLeft,
  iconChevronRight,
  iconClose,
  iconDownload,
  iconEye,
  iconForExtension,
  iconGear,
  iconHeart,
  iconHeartFilled,
  iconKey,
  iconLibrary,
  iconLogout,
  iconMoon,
  iconRestore,
  iconShare,
  iconShield,
  iconSun,
  iconTrash,
  iconUpload,
  iconUsers,
  iconWatch,
} from "./icons.js";

const FILTERS = [
  { value: "", label: "All" },
  { value: "image", label: "Images" },
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
  { value: "pptx", label: "PowerPoint" },
];

const SCOPE_TITLES = {
  mine: "Library",
  favorites: "Favorites",
  shared: "Shared with Me",
  trash: "Recently Deleted",
};

const THEME_ICONS = { light: iconSun, dark: iconMoon, auto: iconAuto };
const THEME_LABELS = {
  light: "Theme: Light (tap for Dark)",
  dark: "Theme: Dark (tap for Auto)",
  auto: "Theme: Auto (tap for Light)",
};

export function mountDashboard(root, session, onLogout) {
  const state = {
    csrfToken: session.csrfToken,
    totpEnabled: session.totpEnabled,
    username: session.username,
    role: session.role,
    scope: "mine",
    albumId: null,
    albumName: "",
    filter: "",
    currentFiles: [],
  };
  let lightboxKeyHandler = null;
  let modalKeyHandler = null;

  render();

  function render() {
    closeLightbox();
    closeModal();
    const currentTheme = getTheme();

    root.innerHTML = `
      <aside class="sidebar">
        <div class="sidebar-brand"><div class="brand">${iconBrand}<span>Lumio</span></div></div>

        <nav class="sidebar-nav">
          <div class="nav-section-label">Library</div>
          <button class="nav-item${state.scope === "mine" ? " active" : ""}" data-scope="mine">${iconLibrary}<span>Library</span></button>
          <button class="nav-item${state.scope === "favorites" ? " active" : ""}" data-scope="favorites">${iconHeart}<span>Favorites</span></button>
          <button class="nav-item${state.scope === "shared" ? " active" : ""}" data-scope="shared">${iconUsers}<span>Shared with Me</span></button>

          <div class="nav-section-label">Albums</div>
          <div class="nav-albums-list" id="nav-albums-list"></div>

          <button class="nav-item${state.scope === "trash" ? " active" : ""}" data-scope="trash">${iconTrash}<span>Recently Deleted</span></button>
        </nav>

        <div class="sidebar-footer">
          <button class="nav-item" id="nav-pair">${iconWatch}<span>Pair Garmin Watch</span></button>
          <button class="nav-item" id="nav-totp">${iconShield}<span>Two-Factor Auth</span></button>
          <button class="nav-item" id="nav-account">${iconKey}<span>Account</span></button>
          ${state.role === "admin" ? `<button class="nav-item" id="nav-admin">${iconGear}<span>Admin</span></button>` : ""}
          <div class="sidebar-user">
            <div class="avatar">${escapeHtml(state.username.slice(0, 1))}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${escapeHtml(state.username)}</div>
              <div class="role-badge${state.role === "admin" ? " admin" : ""}">${state.role === "admin" ? "Admin" : "Member"}</div>
            </div>
            <button class="btn btn-icon" id="btn-theme" title="${THEME_LABELS[currentTheme]}">${THEME_ICONS[currentTheme]}</button>
            <button class="btn btn-icon" id="btn-logout" title="Log out">${iconLogout}</button>
          </div>
        </div>
      </aside>

      <main class="content">
        <div class="content-toolbar">
          <h1>${escapeHtml(scopeTitle())}</h1>
          <div class="content-toolbar-actions">
            <button class="btn btn-primary" id="btn-upload">${iconUpload}<span>Upload</span></button>
          </div>
        </div>

        <div class="filters" id="filters"></div>

        <div class="dropzone" id="dropzone">
          <div id="grid"></div>
        </div>
      </main>

      <input type="file" id="file-input" accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.pptx" multiple hidden />
      <div id="modal-root"></div>
      <div id="lightbox-root"></div>
      <div id="toast-root"></div>
    `;

    renderFilters();
    wireNav();
    wireDropzone();
    wireHeaderActions();
    loadFiles();
    loadAlbums();
  }

  function scopeTitle() {
    if (state.scope === "album") return state.albumName || "Album";
    return SCOPE_TITLES[state.scope] || "Library";
  }

  function wireNav() {
    root.querySelectorAll("[data-scope]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.scope === btn.dataset.scope) return;
        state.scope = btn.dataset.scope;
        render();
      });
    });

    root.querySelector("#nav-pair").addEventListener("click", openPairingModal);
    root.querySelector("#nav-totp").addEventListener("click", openTotpModal);
    root.querySelector("#nav-account").addEventListener("click", openAccountModal);
    root.querySelector("#nav-admin")?.addEventListener("click", openAdminModal);
    root.querySelector("#btn-upload").addEventListener("click", () => root.querySelector("#file-input").click());
    root.querySelector("#btn-theme").addEventListener("click", () => {
      const next = cycleTheme();
      const btn = root.querySelector("#btn-theme");
      btn.innerHTML = THEME_ICONS[next];
      btn.title = THEME_LABELS[next];
    });
  }

  async function loadAlbums() {
    const listEl = root.querySelector("#nav-albums-list");
    if (!listEl) return;

    let albums;
    try {
      albums = await api.listAlbums();
    } catch {
      // Albums (a separate, concurrent backend PR) may not exist in this
      // environment yet, or the request failed for some other reason -
      // either way an empty list is a fine fallback for a best-effort,
      // still-optional sidebar section.
      albums = [];
    }
    if (!listEl.isConnected) return; // the view may have re-rendered while this was in flight

    if (!Array.isArray(albums) || albums.length === 0) {
      listEl.innerHTML = `<div class="nav-albums-empty">No albums yet</div>`;
      return;
    }

    listEl.innerHTML = albums
      .map(
        (album) => `
          <button class="nav-item${state.scope === "album" && state.albumId === album.id ? " active" : ""}" data-album-id="${album.id}" data-album-name="${escapeHtml(album.name)}">
            ${iconAlbum}<span>${escapeHtml(album.name)}</span>
          </button>
        `
      )
      .join("");

    listEl.querySelectorAll("[data-album-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const albumId = Number(btn.dataset.albumId);
        if (state.scope === "album" && state.albumId === albumId) return;
        state.scope = "album";
        state.albumId = albumId;
        state.albumName = btn.dataset.albumName;
        render();
      });
    });
  }

  function renderFilters() {
    const el = root.querySelector("#filters");
    el.innerHTML = FILTERS.map(
      (f) =>
        `<button class="filter-btn${f.value === state.filter ? " active" : ""}" data-value="${f.value}">${f.label}</button>`
    ).join("");

    el.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.dataset.value;
        renderFilters();
        loadFiles();
      });
    });
  }

  async function loadFiles() {
    const grid = root.querySelector("#grid");
    grid.innerHTML = `<p class="empty-state">Loading...</p>`;
    try {
      const albumId = state.scope === "album" ? state.albumId : undefined;
      const files = await api.listFiles(state.filter, state.scope, albumId);
      state.currentFiles = files;
      renderGrid(files);
    } catch (err) {
      grid.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  function emptyStateMessage() {
    if (state.scope === "shared") return "Nothing has been shared with you yet.";
    if (state.scope === "favorites") return "No favorites yet. Tap the heart on a file to add one.";
    if (state.scope === "trash") return "Recently Deleted is empty.";
    if (state.scope === "album") return "This album is empty.";
    return "No files yet. Drag files here or use the upload button.";
  }

  // Files arrive already sorted newest-first, but by different timestamp
  // fields depending on scope (see the backend's ORDER BY per scope) -
  // group by whichever field matches how the list is actually sorted, so
  // the date-range headers line up with the order the cards appear in.
  function groupingTimestamp(file) {
    if (state.scope === "trash") return file.deletedAt;
    if (state.scope === "shared") return file.sharedAt || file.uploadedAt;
    return file.uploadedAt;
  }

  function renderGrid(files) {
    const grid = root.querySelector("#grid");
    if (files.length === 0) {
      grid.innerHTML = `<p class="empty-state">${emptyStateMessage()}</p>`;
      return;
    }

    const groups = groupFilesByDate(files, groupingTimestamp);

    grid.innerHTML = groups
      .map(
        (group) => `
          <div class="grid-group">
            <div class="grid-group-header">${escapeHtml(group.label)}</div>
            <div class="grid">${group.files.map(fileCardHtml).join("")}</div>
          </div>
        `
      )
      .join("");

    grid.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => confirmDelete(Number(btn.dataset.delete)));
    });
    grid.querySelectorAll("[data-share]").forEach((btn) => {
      btn.addEventListener("click", () => openShareModal(Number(btn.dataset.share)));
    });
    grid.querySelectorAll("[data-open-lightbox]").forEach((el) => {
      el.addEventListener("click", () => openLightbox(Number(el.dataset.openLightbox)));
    });
    grid.querySelectorAll("[data-favorite]").forEach((btn) => {
      btn.addEventListener("click", () => toggleFavoriteFromGrid(Number(btn.dataset.favorite)));
    });
    grid.querySelectorAll("[data-restore]").forEach((btn) => {
      btn.addEventListener("click", () => restoreFromTrash(Number(btn.dataset.restore)));
    });
    grid.querySelectorAll("[data-purge]").forEach((btn) => {
      btn.addEventListener("click", () => confirmPurge(Number(btn.dataset.purge)));
    });
  }

  function fileActionsHtml(file) {
    if (state.scope === "shared") {
      return `<a class="btn" href="${downloadUrl(file.id)}" title="Download">${iconDownload}</a>`;
    }

    if (state.scope === "trash") {
      return `
        <a class="btn" href="${downloadUrl(file.id)}" title="Download">${iconDownload}</a>
        <button class="btn" data-restore="${file.id}" title="Restore">${iconRestore}</button>
        <button class="btn btn-danger" data-purge="${file.id}" title="Delete Forever">${iconTrash}</button>
      `;
    }

    return `
      <a class="btn" href="${downloadUrl(file.id)}" title="Download">${iconDownload}</a>
      <button class="btn favorite-btn${file.isFavorite ? " active" : ""}" data-favorite="${file.id}" title="${
        file.isFavorite ? "Remove from Favorites" : "Add to Favorites"
      }">${file.isFavorite ? iconHeartFilled : iconHeart}</button>
      <button class="btn" data-share="${file.id}" title="Share">${iconShare}</button>
      <button class="btn btn-danger" data-delete="${file.id}" title="Delete">${iconTrash}</button>
    `;
  }

  function trashBadgeHtml(file) {
    if (state.scope !== "trash" || typeof file.purgeAt !== "number") return "";
    const secondsLeft = file.purgeAt - Date.now() / 1000;
    const daysLeft = Math.max(0, Math.ceil(secondsLeft / 86400));
    const warning = daysLeft <= 3;
    const label = daysLeft <= 0 ? "Purging soon" : `${daysLeft}d left`;
    return `<div class="trash-badge${warning ? " trash-badge-warning" : ""}">${label}</div>`;
  }

  function fileCardHtml(file) {
    const thumb = file.hasThumbnail
      ? `<img src="${thumbnailUrl(file.id)}" alt="" loading="lazy" />`
      : iconForExtension(file.extension);

    const sub =
      state.scope === "shared" && file.sharedBy
        ? `Shared by ${escapeHtml(file.sharedBy)}`
        : `${formatBytes(file.sizeBytes)} &middot; ${formatDate(file.uploadedAt)}`;

    // Only real photos open the gallery view - a PDF/Word/PowerPoint icon
    // has nothing bigger to show.
    const thumbAttr = file.hasThumbnail ? ` data-open-lightbox="${file.id}"` : "";

    return `
      <div class="file-card">
        <div class="file-actions">${fileActionsHtml(file)}</div>
        ${trashBadgeHtml(file)}
        <div class="file-thumb"${thumbAttr}>${thumb}</div>
        <div class="file-meta">
          <div class="file-name" title="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</div>
          <div class="file-sub">${sub}</div>
        </div>
      </div>
    `;
  }

  async function toggleFavoriteFromGrid(id) {
    const btn = root.querySelector(`[data-favorite="${id}"]`);
    const file = state.currentFiles.find((f) => f.id === id);
    if (!file || !btn) return;

    const next = !file.isFavorite;
    file.isFavorite = next;
    setFavoriteButtonState(btn, next);

    try {
      await api.toggleFavorite(id, next, state.csrfToken);
      // Leaving the Favorites view itself is the one case where the card
      // needs to actually disappear once unfavorited - everywhere else the
      // optimistic icon flip is the whole story.
      if (state.scope === "favorites" && !next) {
        loadFiles();
      }
    } catch (err) {
      file.isFavorite = !next;
      setFavoriteButtonState(btn, !next);
      showToast(err.message, true);
    }
  }

  function setFavoriteButtonState(btn, isFavorite) {
    btn.innerHTML = isFavorite ? iconHeartFilled : iconHeart;
    btn.classList.toggle("active", isFavorite);
    btn.title = isFavorite ? "Remove from Favorites" : "Add to Favorites";
  }

  async function restoreFromTrash(id) {
    try {
      await api.restoreFile(id, state.csrfToken);
      loadFiles();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function confirmPurge(id) {
    openModal(`
      <h2>Delete forever?</h2>
      <p>This permanently removes the file and its data. This can't be undone.</p>
      <div class="modal-actions">
        <button class="btn" id="cancel-purge">Cancel</button>
        <button class="btn btn-danger" id="confirm-purge">Delete Forever</button>
      </div>
    `);
    root.querySelector("#cancel-purge").addEventListener("click", closeModal);
    root.querySelector("#confirm-purge").addEventListener("click", async () => {
      try {
        await api.purgeFile(id, state.csrfToken);
        closeModal();
        loadFiles();
      } catch (err) {
        closeModal();
        showToast(err.message, true);
      }
    });
  }

  // ---------- Gallery lightbox ----------

  function openLightbox(fileId) {
    const images = state.currentFiles.filter((f) => f.hasThumbnail);
    const index = images.findIndex((f) => f.id === fileId);
    if (index === -1) return;
    renderLightbox(images, index);
  }

  function renderLightbox(images, index) {
    const file = images[index];
    // Trash gets the same read-only treatment as shared-with-me here -
    // restore/delete-forever stay grid-card-only actions, matching how
    // this scope's other actions never grew a lightbox-footer equivalent.
    const canManage = state.scope !== "shared" && state.scope !== "trash";

    root.querySelector("#lightbox-root").innerHTML = `
      <div class="lightbox-backdrop" id="lightbox-backdrop">
        <button class="lightbox-close" id="lightbox-close" title="Close">${iconClose}</button>
        ${index > 0 ? `<button class="lightbox-nav lightbox-prev" id="lightbox-prev" title="Previous">${iconChevronLeft}</button>` : ""}
        <div class="lightbox-stage">
          <img src="${previewUrl(file.id)}" alt="${escapeHtml(file.originalName)}" />
        </div>
        ${index < images.length - 1 ? `<button class="lightbox-nav lightbox-next" id="lightbox-next" title="Next">${iconChevronRight}</button>` : ""}
        <div class="lightbox-footer">
          <div class="lightbox-name">${escapeHtml(file.originalName)}</div>
          <div class="lightbox-actions">
            <a class="btn btn-icon" href="${downloadUrl(file.id)}" title="Download">${iconDownload}</a>
            ${
              canManage
                ? `<button class="btn btn-icon favorite-btn${file.isFavorite ? " active" : ""}" id="lightbox-favorite" title="${
                    file.isFavorite ? "Remove from Favorites" : "Add to Favorites"
                  }">${file.isFavorite ? iconHeartFilled : iconHeart}</button>`
                : ""
            }
            ${canManage ? `<button class="btn btn-icon" id="lightbox-share" title="Share">${iconShare}</button>` : ""}
            ${canManage ? `<button class="btn btn-icon btn-danger" id="lightbox-delete" title="Delete">${iconTrash}</button>` : ""}
          </div>
        </div>
      </div>
    `;

    root.querySelector("#lightbox-close").addEventListener("click", closeLightbox);
    root.querySelector("#lightbox-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "lightbox-backdrop") closeLightbox();
    });
    root.querySelector("#lightbox-prev")?.addEventListener("click", () => renderLightbox(images, index - 1));
    root.querySelector("#lightbox-next")?.addEventListener("click", () => renderLightbox(images, index + 1));
    root.querySelector("#lightbox-favorite")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const next = !file.isFavorite;
      file.isFavorite = next;
      setFavoriteButtonState(btn, next);
      // Keep the grid card behind the lightbox in sync without a full reload.
      const gridBtn = root.querySelector(`[data-favorite="${file.id}"]`);
      if (gridBtn) setFavoriteButtonState(gridBtn, next);
      try {
        await api.toggleFavorite(file.id, next, state.csrfToken);
      } catch (err) {
        file.isFavorite = !next;
        setFavoriteButtonState(btn, !next);
        if (gridBtn) setFavoriteButtonState(gridBtn, !next);
        showToast(err.message, true);
      }
    });
    root.querySelector("#lightbox-share")?.addEventListener("click", () => {
      closeLightbox();
      openShareModal(file.id);
    });
    root.querySelector("#lightbox-delete")?.addEventListener("click", () => {
      closeLightbox();
      confirmDelete(file.id);
    });

    if (lightboxKeyHandler) document.removeEventListener("keydown", lightboxKeyHandler);
    lightboxKeyHandler = (e) => {
      if (e.key === "Escape") {
        closeLightbox();
      } else if (e.key === "ArrowLeft" && index > 0) {
        renderLightbox(images, index - 1);
      } else if (e.key === "ArrowRight" && index < images.length - 1) {
        renderLightbox(images, index + 1);
      }
    };
    document.addEventListener("keydown", lightboxKeyHandler);
  }

  function closeLightbox() {
    const lightboxRoot = root.querySelector("#lightbox-root");
    if (lightboxRoot) lightboxRoot.innerHTML = "";
    if (lightboxKeyHandler) {
      document.removeEventListener("keydown", lightboxKeyHandler);
      lightboxKeyHandler = null;
    }
  }

  async function confirmDelete(id) {
    openModal(`
      <h2>Delete file?</h2>
      <p>It moves to Recently Deleted, where it can be restored until it's automatically purged.</p>
      <div class="modal-actions">
        <button class="btn" id="cancel-delete">Cancel</button>
        <button class="btn btn-danger" id="confirm-delete">Delete</button>
      </div>
    `);
    root.querySelector("#cancel-delete").addEventListener("click", closeModal);
    root.querySelector("#confirm-delete").addEventListener("click", async () => {
      try {
        await api.deleteFile(id, state.csrfToken);
        closeModal();
        loadFiles();
      } catch (err) {
        closeModal();
        showToast(err.message, true);
      }
    });
  }

  async function openShareModal(id) {
    openModal(`
      <h2>Share file</h2>
      <p>Anyone you share with can view and download it - never delete or re-share it.</p>
      <div class="inline-form">
        <input type="text" id="share-username" placeholder="Username" autocomplete="off" />
        <button class="btn btn-secondary" id="share-submit">Share</button>
      </div>
      <p class="error-text" id="share-error"></p>
      <div class="row-list" id="share-list"><p class="empty-state" style="padding:20px;">Loading...</p></div>
      <div class="modal-actions"><button class="btn" id="close-share">Done</button></div>
    `);
    root.querySelector("#close-share").addEventListener("click", closeModal);
    root.querySelector("#share-submit").addEventListener("click", () => submitShare(id));
    root.querySelector("#share-username").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitShare(id);
    });

    await loadShares(id);
  }

  async function loadShares(id) {
    const listEl = root.querySelector("#share-list");
    if (!listEl) return;
    try {
      const shares = await api.listShares(id);
      if (shares.length === 0) {
        listEl.innerHTML = `<p class="empty-state" style="padding:16px;">Not shared with anyone yet.</p>`;
        return;
      }
      listEl.innerHTML = shares
        .map(
          (s) => `
            <div class="share-row">
              <div class="avatar">${escapeHtml(s.username.slice(0, 1))}</div>
              <div class="row-name">${escapeHtml(s.username)}</div>
              <button class="btn btn-icon btn-danger" data-revoke="${s.userId}" title="Revoke access">${iconClose}</button>
            </div>
          `
        )
        .join("");
      listEl.querySelectorAll("[data-revoke]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api.unshareFile(id, Number(btn.dataset.revoke), state.csrfToken);
            await loadShares(id);
          } catch (err) {
            showToast(err.message, true);
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = `<p class="empty-state" style="padding:16px;">${escapeHtml(err.message)}</p>`;
    }
  }

  async function submitShare(id) {
    const input = root.querySelector("#share-username");
    const errorEl = root.querySelector("#share-error");
    errorEl.textContent = "";
    const username = input.value.trim();
    if (!username) return;

    try {
      await api.shareFile(id, username, state.csrfToken);
      input.value = "";
      await loadShares(id);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  }

  function wireDropzone() {
    const zone = root.querySelector("#dropzone");
    const input = root.querySelector("#file-input");

    ["dragenter", "dragover"].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        zone.classList.add("drag-active");
      })
    );
    ["dragleave", "drop"].forEach((evt) =>
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        if (evt === "dragleave" && e.target !== zone) return;
        zone.classList.remove("drag-active");
      })
    );
    zone.addEventListener("drop", (e) => {
      handleFiles(e.dataTransfer.files);
    });

    input.addEventListener("change", () => {
      handleFiles(input.files);
      input.value = "";
    });
  }

  async function handleFiles(fileList) {
    for (const file of Array.from(fileList)) {
      await handleSingleUpload(file);
    }
    // Uploads always land in Library - switch there so the result is
    // actually visible regardless of which scope was being viewed.
    if (state.scope !== "mine") {
      state.scope = "mine";
      render();
    } else {
      loadFiles();
    }
  }

  function handleSingleUpload(file) {
    const toastRoot = root.querySelector("#toast-root");
    toastRoot.innerHTML = `
      <div class="upload-toast glass">
        <div class="upload-toast-name">${escapeHtml(file.name)}</div>
        <div class="progress-track"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
      </div>
    `;
    const fill = toastRoot.querySelector("#progress-fill");

    return uploadFile(file, state.csrfToken, (ratio) => {
      fill.style.width = `${Math.round(ratio * 100)}%`;
    })
      .catch((err) => showToast(err.message, true))
      .finally(() => {
        setTimeout(() => (toastRoot.innerHTML = ""), 600);
      });
  }

  function wireHeaderActions() {
    root.querySelector("#btn-logout").addEventListener("click", async () => {
      try {
        await api.logout(state.csrfToken);
      } finally {
        onLogout();
      }
    });
  }

  async function openPairingModal() {
    openModal(`<h2>Pair your Garmin watch</h2><p>Generating a code...</p>`);
    try {
      const { code, expiresAt } = await api.createPairingCode(state.csrfToken);
      renderPairingCode(code, expiresAt);
    } catch (err) {
      openModal(`<h2>Couldn't create a code</h2><p>${escapeHtml(err.message)}</p>`);
    }
  }

  function renderPairingCode(code, expiresAt) {
    openModal(`
      <h2>Pair your Garmin watch</h2>
      <p>Enter this code in the Lumio watch app.</p>
      <div class="pairing-code">${code}</div>
      <p id="pairing-countdown"></p>
      <div class="modal-actions"><button class="btn" id="close-pairing">Close</button></div>
    `);
    root.querySelector("#close-pairing").addEventListener("click", closeModal);

    const tick = () => {
      const el = root.querySelector("#pairing-countdown");
      if (!el) return;
      const secondsLeft = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
      el.textContent = secondsLeft > 0 ? `Expires in ${secondsLeft}s` : "Expired - generate a new code";
      if (secondsLeft > 0) setTimeout(tick, 1000);
    };
    tick();
  }

  async function openTotpModal() {
    if (state.totpEnabled) {
      openModal(`
        <h2>Two-factor authentication</h2>
        <p>Currently enabled. Enter your password to turn it off.</p>
        <div class="field"><input type="password" id="totp-disable-password" placeholder="Password" /></div>
        <p class="error-text" id="totp-error"></p>
        <div class="modal-actions">
          <button class="btn" id="cancel-totp">Cancel</button>
          <button class="btn btn-danger" id="disable-totp">Disable</button>
        </div>
      `);
      root.querySelector("#cancel-totp").addEventListener("click", closeModal);
      root.querySelector("#disable-totp").addEventListener("click", async () => {
        const password = root.querySelector("#totp-disable-password").value;
        try {
          await api.totpDisable(password, state.csrfToken);
          state.totpEnabled = false;
          closeModal();
        } catch (err) {
          root.querySelector("#totp-error").textContent = err.message;
        }
      });
      return;
    }

    try {
      const { secret, otpauthUri } = await api.totpSetup(state.csrfToken);
      openModal(`
        <h2>Set up two-factor authentication</h2>
        <p>Add this key to your authenticator app (manual entry):</p>
        <div class="pairing-code" style="font-size:1.1rem;letter-spacing:0.05em;word-break:break-all;">${secret}</div>
        <div class="field"><input type="text" id="totp-confirm-code" placeholder="6-digit code" inputmode="numeric" maxlength="6" /></div>
        <p class="error-text" id="totp-error"></p>
        <div class="modal-actions">
          <button class="btn" id="cancel-totp">Cancel</button>
          <button class="btn btn-primary" id="confirm-totp">Enable</button>
        </div>
      `);
      root.querySelector("#cancel-totp").addEventListener("click", closeModal);
      root.querySelector("#confirm-totp").addEventListener("click", async () => {
        const token = root.querySelector("#totp-confirm-code").value;
        try {
          await api.totpConfirm(token, state.csrfToken);
          state.totpEnabled = true;
          closeModal();
        } catch (err) {
          root.querySelector("#totp-error").textContent = err.message;
        }
      });
      void otpauthUri; // reserved for a future QR rendering pass
    } catch (err) {
      openModal(`<h2>Couldn't start setup</h2><p>${escapeHtml(err.message)}</p>`);
    }
  }

  function openAccountModal() {
    openModal(`
      <h2>Change password</h2>
      <div class="field">
        <label for="acct-current">Current password</label>
        <div class="password-field">
          <input id="acct-current" type="password" autocomplete="current-password" />
          <button type="button" class="password-toggle" data-toggle="acct-current" title="Show password">${iconEye}</button>
        </div>
      </div>
      <div class="field">
        <label for="acct-new">New password</label>
        <div class="password-field">
          <input id="acct-new" type="password" autocomplete="new-password" minlength="12" />
          <button type="button" class="password-toggle" data-toggle="acct-new" title="Show password">${iconEye}</button>
        </div>
        <div class="field-hint">At least 12 characters.</div>
      </div>
      <div class="field">
        <label for="acct-confirm">Confirm new password</label>
        <div class="password-field">
          <input id="acct-confirm" type="password" autocomplete="new-password" />
          <button type="button" class="password-toggle" data-toggle="acct-confirm" title="Show password">${iconEye}</button>
        </div>
      </div>
      <p class="error-text" id="acct-error"></p>
      <div class="modal-actions">
        <button class="btn" id="cancel-acct">Cancel</button>
        <button class="btn btn-primary" id="save-acct">Save</button>
      </div>
    `);
    wirePasswordToggles(root);
    root.querySelector("#cancel-acct").addEventListener("click", closeModal);
    root.querySelector("#save-acct").addEventListener("click", async () => {
      const errorEl = root.querySelector("#acct-error");
      const current = root.querySelector("#acct-current").value;
      const next = root.querySelector("#acct-new").value;
      const confirm = root.querySelector("#acct-confirm").value;

      if (next !== confirm) {
        errorEl.textContent = "New passwords do not match";
        return;
      }
      try {
        await api.changePassword(current, next, state.csrfToken);
        closeModal();
        showToast("Password updated");
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  }

  async function openAdminModal() {
    openModal(
      `
      <h2>Admin</h2>
      <div class="modal-tabs" id="admin-tabs">
        <button class="modal-tab active" data-tab="users">Users</button>
        <button class="modal-tab" data-tab="settings">Settings</button>
      </div>
      <div id="admin-tab-content"></div>
      <div class="modal-actions"><button class="btn" id="close-admin">Done</button></div>
    `,
      { wide: true }
    );
    root.querySelector("#close-admin").addEventListener("click", closeModal);
    root.querySelectorAll("#admin-tabs .modal-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        root.querySelectorAll("#admin-tabs .modal-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderAdminTab(btn.dataset.tab);
      });
    });

    await renderAdminTab("users");
  }

  async function renderAdminTab(tab) {
    const content = root.querySelector("#admin-tab-content");
    if (!content) return;

    if (tab === "settings") {
      content.innerHTML = `<p class="empty-state" style="padding:20px;">Loading...</p>`;
      try {
        const { autoUpdateEnabled } = await api.getSettings();
        content.innerHTML = `
          <div class="settings-row">
            <div>
              <div class="settings-row-label">Auto-update</div>
              <div class="settings-row-hint">Automatically deploy new releases when they're published.</div>
            </div>
            <button class="switch${autoUpdateEnabled ? " on" : ""}" id="toggle-auto-update"></button>
          </div>
        `;
        content.querySelector("#toggle-auto-update").addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          const next = !btn.classList.contains("on");
          try {
            await api.updateSettings(next, state.csrfToken);
            btn.classList.toggle("on", next);
          } catch (err) {
            showToast(err.message, true);
          }
        });
      } catch (err) {
        content.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
      }
      return;
    }

    content.innerHTML = `
      <div class="field">
        <label for="new-user-username">Username</label>
        <input type="text" id="new-user-username" autocomplete="off" pattern="[a-zA-Z0-9._-]{3,32}" maxlength="32" />
        <div class="field-hint">3-32 characters: letters, numbers, dots, hyphens, or underscores.</div>
      </div>
      <div class="inline-form">
        <div class="password-field" style="flex:1;">
          <input type="password" id="new-user-password" placeholder="Password (12+ characters)" autocomplete="new-password" />
          <button type="button" class="password-toggle" data-toggle="new-user-password" title="Show password">${iconEye}</button>
        </div>
        <div class="password-field" style="flex:1;">
          <input type="password" id="new-user-confirm" placeholder="Confirm password" autocomplete="new-password" />
          <button type="button" class="password-toggle" data-toggle="new-user-confirm" title="Show password">${iconEye}</button>
        </div>
      </div>
      <button class="btn btn-secondary" id="new-user-submit" style="width:100%;margin-top:10px;">Add user</button>
      <p class="error-text" id="admin-users-error"></p>
      <div class="row-list" id="user-list"><p class="empty-state" style="padding:20px;">Loading...</p></div>
    `;
    content.querySelector("#new-user-submit").addEventListener("click", submitNewUser);
    wirePasswordToggles(content);
    await loadUsers();
  }

  async function submitNewUser() {
    const usernameEl = root.querySelector("#new-user-username");
    const passwordEl = root.querySelector("#new-user-password");
    const confirmEl = root.querySelector("#new-user-confirm");
    const errorEl = root.querySelector("#admin-users-error");
    errorEl.textContent = "";

    const username = usernameEl.value.trim();
    if (passwordEl.value !== confirmEl.value) {
      errorEl.textContent = "Passwords do not match";
      return;
    }

    try {
      await api.createUser(username, passwordEl.value, state.csrfToken);
      usernameEl.value = "";
      passwordEl.value = "";
      confirmEl.value = "";
      await loadUsers();
      showToast(`Account "${username}" created.`);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  }

  async function loadUsers() {
    const listEl = root.querySelector("#user-list");
    if (!listEl) return;
    try {
      const users = await api.listUsers();
      listEl.innerHTML = users
        .map(
          (u) => `
            <div class="user-row">
              <div class="avatar">${escapeHtml(u.username.slice(0, 1))}</div>
              <div class="row-name">${escapeHtml(u.username)}
                <span class="role-badge${u.role === "admin" ? " admin" : ""}">${u.role === "admin" ? "Admin" : "Member"}</span>
              </div>
              <div class="row-sub">${formatDate(u.createdAt)}</div>
              ${
                u.username === state.username
                  ? ""
                  : `<button class="btn btn-icon btn-danger" data-delete-user="${u.id}" title="Remove user">${iconTrash}</button>`
              }
            </div>
          `
        )
        .join("");
      listEl.querySelectorAll("[data-delete-user]").forEach((btn) => {
        btn.addEventListener("click", () => confirmDeleteUser(Number(btn.dataset.deleteUser)));
      });
    } catch (err) {
      listEl.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  function confirmDeleteUser(id) {
    openModal(`
      <h2>Remove this user?</h2>
      <p>Their account and all of their files will be permanently deleted. This can't be undone.</p>
      <div class="modal-actions">
        <button class="btn" id="cancel-remove-user">Cancel</button>
        <button class="btn btn-danger" id="confirm-remove-user">Remove</button>
      </div>
    `);
    root.querySelector("#cancel-remove-user").addEventListener("click", () => openAdminModal());
    root.querySelector("#confirm-remove-user").addEventListener("click", async () => {
      try {
        await api.deleteUser(id, state.csrfToken);
        await openAdminModal();
      } catch (err) {
        closeModal();
        showToast(err.message, true);
      }
    });
  }

  function openModal(html, { wide = false } = {}) {
    root.querySelector("#modal-root").innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal glass${wide ? " modal-wide" : ""}">
          <button class="btn btn-icon" id="modal-close" style="float:right;margin:-8px -8px 0 0;">${iconClose}</button>
          ${html}
        </div>
      </div>
    `;
    root.querySelector("#modal-close").addEventListener("click", closeModal);
    root.querySelector("#modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });

    if (modalKeyHandler) document.removeEventListener("keydown", modalKeyHandler);
    modalKeyHandler = (e) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", modalKeyHandler);

    // First real input in the modal, if any - lets a keyboard/screen-
    // reader user start typing immediately instead of having to tab in.
    root.querySelector(".modal input, .modal button:not(#modal-close)")?.focus();
  }

  function closeModal() {
    const modalRoot = root.querySelector("#modal-root");
    if (modalRoot) modalRoot.innerHTML = "";
    if (modalKeyHandler) {
      document.removeEventListener("keydown", modalKeyHandler);
      modalKeyHandler = null;
    }
  }

  function showToast(message, isError) {
    const toastRoot = root.querySelector("#toast-root");
    toastRoot.innerHTML = `<div class="upload-toast glass"><div class="upload-toast-name" style="color:${isError ? "var(--danger)" : "var(--text-0)"}">${escapeHtml(message)}</div></div>`;
    setTimeout(() => (toastRoot.innerHTML = ""), 3000);
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
