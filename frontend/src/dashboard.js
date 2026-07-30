import { api, downloadUrl, thumbnailUrl, uploadFile } from "./api.js";
import {
  iconBrand,
  iconClose,
  iconDownload,
  iconForExtension,
  iconLogout,
  iconShield,
  iconTrash,
  iconUpload,
  iconWatch,
} from "./icons.js";

const FILTERS = [
  { value: "", label: "All" },
  { value: "image", label: "Images" },
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
  { value: "pptx", label: "PowerPoint" },
];

export function mountDashboard(root, session, onLogout) {
  const state = {
    csrfToken: session.csrfToken,
    totpEnabled: session.totpEnabled,
    filter: "",
  };

  root.innerHTML = `
    <div class="topbar glass">
      <div class="brand">${iconBrand}<span>Lumio</span></div>
      <div class="topbar-actions">
        <span class="username-pill">${escapeHtml(session.username)}</span>
        <button class="btn btn-icon" id="btn-totp" title="Two-factor authentication">${iconShield}</button>
        <button class="btn btn-icon" id="btn-pair" title="Pair Garmin watch">${iconWatch}</button>
        <button class="btn btn-icon" id="btn-logout" title="Log out">${iconLogout}</button>
      </div>
    </div>

    <div class="filters glass" id="filters"></div>

    <div class="dropzone" id="dropzone">
      <div class="grid" id="grid"></div>
    </div>

    <input type="file" id="file-input" accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.pptx" multiple hidden />
    <div id="modal-root"></div>
    <div id="toast-root"></div>
  `;

  renderFilters();
  wireDropzone();
  wireHeaderActions();
  wireUploadEntryPoint();
  loadFiles();

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
      const files = await api.listFiles(state.filter);
      renderGrid(files);
    } catch (err) {
      grid.innerHTML = `<p class="empty-state">${escapeHtml(err.message)}</p>`;
    }
  }

  function renderGrid(files) {
    const grid = root.querySelector("#grid");
    if (files.length === 0) {
      grid.innerHTML = `<p class="empty-state">No files yet. Drag files here or use the upload button.</p>`;
      return;
    }

    grid.innerHTML = files.map(fileCardHtml).join("");

    grid.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => confirmDelete(Number(btn.dataset.delete)));
    });
  }

  function fileCardHtml(file) {
    const thumb = file.hasThumbnail
      ? `<img src="${thumbnailUrl(file.id)}" alt="" loading="lazy" />`
      : iconForExtension(file.extension);

    return `
      <div class="file-card glass">
        <div class="file-actions">
          <a class="btn" href="${downloadUrl(file.id)}" title="Download">${iconDownload}</a>
          <button class="btn btn-danger" data-delete="${file.id}" title="Delete">${iconTrash}</button>
        </div>
        <div class="file-thumb">${thumb}</div>
        <div class="file-meta">
          <div class="file-name" title="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</div>
          <div class="file-sub">${formatBytes(file.sizeBytes)} &middot; ${formatDate(file.uploadedAt)}</div>
        </div>
      </div>
    `;
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
    loadFiles();
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

    root.querySelector("#btn-pair").addEventListener("click", openPairingModal);
    root.querySelector("#btn-totp").addEventListener("click", openTotpModal);
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
      <p>Enter this code in the Lumio watch app. It expires in a few minutes.</p>
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

  function openModal(html) {
    root.querySelector("#modal-root").innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal glass">
          <button class="btn btn-icon" id="modal-close" style="float:right;margin:-8px -8px 0 0;">${iconClose}</button>
          ${html}
        </div>
      </div>
    `;
    root.querySelector("#modal-close").addEventListener("click", closeModal);
    root.querySelector("#modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });
  }

  function closeModal() {
    root.querySelector("#modal-root").innerHTML = "";
  }

  function showToast(message, isError) {
    const toastRoot = root.querySelector("#toast-root");
    toastRoot.innerHTML = `<div class="upload-toast glass"><div class="upload-toast-name" style="color:${isError ? "var(--danger)" : "var(--text-0)"}">${escapeHtml(message)}</div></div>`;
    setTimeout(() => (toastRoot.innerHTML = ""), 3000);
  }

  function wireUploadEntryPoint() {
    // The dropzone doubles as the click target for the hidden file input,
    // so there's a non-drag way in for mouse/keyboard/touch users too.
    const actions = root.querySelector(".topbar-actions");
    const uploadBtn = document.createElement("button");
    uploadBtn.className = "btn btn-icon";
    uploadBtn.title = "Upload";
    uploadBtn.innerHTML = iconUpload;
    uploadBtn.addEventListener("click", () => root.querySelector("#file-input").click());
    actions.insertBefore(uploadBtn, actions.firstChild);
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
