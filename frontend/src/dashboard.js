import { api, downloadUrl, previewUrl, thumbnailUrl, uploadFile } from "./api.js";
import { wirePasswordToggles } from "./setup.js";
import {
  iconBrand,
  iconChevronLeft,
  iconChevronRight,
  iconClose,
  iconDownload,
  iconEye,
  iconForExtension,
  iconGear,
  iconKey,
  iconLibrary,
  iconLogout,
  iconShare,
  iconShield,
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
  mine: "My Files",
  shared: "Shared with Me",
};

export function mountDashboard(root, session, onLogout) {
  const state = {
    csrfToken: session.csrfToken,
    totpEnabled: session.totpEnabled,
    username: session.username,
    role: session.role,
    scope: "mine",
    filter: "",
    currentFiles: [],
  };
  let lightboxKeyHandler = null;
  let modalKeyHandler = null;

  render();

  function render() {
    closeLightbox();
    closeModal();
    root.innerHTML = `
      <aside class="sidebar">
        <div class="sidebar-brand"><div class="brand">${iconBrand}<span>Lumio</span></div></div>

        <nav class="sidebar-nav">
          <div class="nav-section-label">Library</div>
          <button class="nav-item${state.scope === "mine" ? " active" : ""}" data-scope="mine">${iconLibrary}<span>My Files</span></button>
          <button class="nav-item${state.scope === "shared" ? " active" : ""}" data-scope="shared">${iconUsers}<span>Shared with Me</span></button>
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
            <button class="btn btn-icon" id="btn-logout" title="Log out">${iconLogout}</button>
          </div>
        </div>
      </aside>

      <main class="content">
        <div class="content-toolbar">
          <h1>${SCOPE_TITLES[state.scope]}</h1>
          <div class="content-toolbar-actions">
            <button class="btn btn-primary" id="btn-upload">${iconUpload}<span>Upload</span></button>
          </div>
        </div>

        <div class="filters" id="filters"></div>

        <div class="dropzone" id="dropzone">
          <div class="grid" id="grid"></div>
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
      const files = await api.listFiles(state.filter, state.scope);
      state.currentFiles = files;
      renderGrid(files);
    } catch (err) {
      grid.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  function renderGrid(files) {
    const grid = root.querySelector("#grid");
    if (files.length === 0) {
      grid.innerHTML = `<p class="empty-state">${
        state.scope === "shared"
          ? "Nothing has been shared with you yet."
          : "No files yet. Drag files here or use the upload button."
      }</p>`;
      return;
    }

    grid.innerHTML = files.map(fileCardHtml).join("");

    grid.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => confirmDelete(Number(btn.dataset.delete)));
    });
    grid.querySelectorAll("[data-share]").forEach((btn) => {
      btn.addEventListener("click", () => openShareModal(Number(btn.dataset.share)));
    });
    grid.querySelectorAll("[data-open-lightbox]").forEach((el) => {
      el.addEventListener("click", () => openLightbox(Number(el.dataset.openLightbox)));
    });
  }

  function fileCardHtml(file) {
    const thumb = file.hasThumbnail
      ? `<img src="${thumbnailUrl(file.id)}" alt="" loading="lazy" />`
      : iconForExtension(file.extension);

    const actions =
      state.scope === "shared"
        ? `<a class="btn" href="${downloadUrl(file.id)}" title="Download">${iconDownload}</a>`
        : `
          <a class="btn" href="${downloadUrl(file.id)}" title="Download">${iconDownload}</a>
          <button class="btn" data-share="${file.id}" title="Share">${iconShare}</button>
          <button class="btn btn-danger" data-delete="${file.id}" title="Delete">${iconTrash}</button>
        `;

    const sub =
      state.scope === "shared" && file.sharedBy
        ? `Shared by ${escapeHtml(file.sharedBy)}`
        : `${formatBytes(file.sizeBytes)} &middot; ${formatDate(file.uploadedAt)}`;

    // Only real photos open the gallery view - a PDF/Word/PowerPoint icon
    // has nothing bigger to show.
    const thumbAttr = file.hasThumbnail ? ` data-open-lightbox="${file.id}"` : "";

    return `
      <div class="file-card">
        <div class="file-actions">${actions}</div>
        <div class="file-thumb"${thumbAttr}>${thumb}</div>
        <div class="file-meta">
          <div class="file-name" title="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</div>
          <div class="file-sub">${sub}</div>
        </div>
      </div>
    `;
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
    const canManage = state.scope !== "shared";

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
      <p>This can't be undone.</p>
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
    // Uploads always land in "my files" - switch there so the result is
    // actually visible if the user was looking at "shared with me".
    if (state.scope === "shared") {
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
