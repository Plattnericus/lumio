const API_BASE = "/api";

async function request(path, { method = "GET", body, csrfToken } = {}) {
  const headers = {};
  let payload = body;

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: payload,
    credentials: "same-origin",
  });

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : null;

  if (!res.ok) {
    const error = new Error(data?.error || res.statusText);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  me: () => request("/auth/me"),
  login: (username, password) => request("/auth/login", { method: "POST", body: { username, password } }),
  loginTotp: (token) => request("/auth/login/totp", { method: "POST", body: { token } }),
  logout: (csrfToken) => request("/auth/logout", { method: "POST", csrfToken }),
  totpSetup: (csrfToken) => request("/auth/totp/setup", { method: "POST", csrfToken }),
  totpConfirm: (token, csrfToken) =>
    request("/auth/totp/confirm", { method: "POST", body: { token }, csrfToken }),
  totpDisable: (password, csrfToken) =>
    request("/auth/totp/disable", { method: "POST", body: { password }, csrfToken }),
  changePassword: (currentPassword, newPassword, csrfToken) =>
    request("/auth/password", { method: "POST", body: { currentPassword, newPassword }, csrfToken }),

  setupStatus: () => request("/setup/status"),
  setupCreate: (username, password, setupToken) =>
    request("/setup", { method: "POST", body: { username, password, setupToken } }),

  listFiles: (type, scope) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (scope) params.set("scope", scope);
    const query = params.toString();
    return request(`/files${query ? `?${query}` : ""}`);
  },
  deleteFile: (id, csrfToken) => request(`/files/${id}`, { method: "DELETE", csrfToken }),
  shareFile: (id, username, csrfToken) =>
    request(`/files/${id}/shares`, { method: "POST", body: { username }, csrfToken }),
  listShares: (id) => request(`/files/${id}/shares`),
  unshareFile: (id, userId, csrfToken) =>
    request(`/files/${id}/shares/${userId}`, { method: "DELETE", csrfToken }),

  createPairingCode: (csrfToken) => request("/pairing/codes", { method: "POST", csrfToken }),

  listUsers: () => request("/admin/users"),
  createUser: (username, password, csrfToken) =>
    request("/admin/users", { method: "POST", body: { username, password }, csrfToken }),
  deleteUser: (id, csrfToken) => request(`/admin/users/${id}`, { method: "DELETE", csrfToken }),

  getSettings: () => request("/settings"),
  updateSettings: (autoUpdateEnabled, csrfToken) =>
    request("/settings", { method: "PUT", body: { autoUpdateEnabled }, csrfToken }),
};

export function downloadUrl(id) {
  return `${API_BASE}/files/${id}/download`;
}

export function thumbnailUrl(id) {
  return `${API_BASE}/files/${id}/thumbnail`;
}

// XHR, not fetch: it's the only one of the two that reports upload
// progress, which the drop-zone UI needs.
export function uploadFile(file, csrfToken, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/files`);
    xhr.setRequestHeader("X-CSRF-Token", csrfToken);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });

    xhr.onload = () => {
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        // non-JSON error body, fall through with a generic message
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(Object.assign(new Error(data?.error || xhr.statusText || "Upload failed"), { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}
