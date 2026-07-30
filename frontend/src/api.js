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
  listFiles: (type) => request(`/files${type ? `?type=${type}` : ""}`),
  deleteFile: (id, csrfToken) => request(`/files/${id}`, { method: "DELETE", csrfToken }),
  createPairingCode: (csrfToken) => request("/pairing/codes", { method: "POST", csrfToken }),
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
