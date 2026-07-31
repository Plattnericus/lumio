import { api } from "./api.js";
import { iconBrand, iconEye, iconEyeOff, iconKey } from "./icons.js";

export function mountSetup(root, onSuccess) {
  render();

  function render() {
    root.innerHTML = `
      <div class="login-card wide glass">
        <div class="brand">${iconBrand}<span>Lumio</span></div>
        <p class="lede">Create the admin account to get started.</p>
        <form id="setup-form">
          <div class="field">
            <label for="setup-username">Username</label>
            <input id="setup-username" name="username" type="text" autocomplete="username"
              pattern="[a-zA-Z0-9._-]{3,32}" maxlength="32" required />
            <div class="field-hint">3-32 characters: letters, numbers, dots, hyphens, or underscores.</div>
          </div>
          <div class="field">
            <label for="setup-password">Password</label>
            <div class="password-field">
              <input id="setup-password" name="password" type="password" autocomplete="new-password" minlength="12" required />
              <button type="button" class="password-toggle" data-toggle="setup-password" title="Show password">${iconEye}</button>
            </div>
            <div class="field-hint">At least 12 characters.</div>
          </div>
          <div class="field">
            <label for="setup-confirm">Confirm password</label>
            <div class="password-field">
              <input id="setup-confirm" name="confirm" type="password" autocomplete="new-password" required />
              <button type="button" class="password-toggle" data-toggle="setup-confirm" title="Show password">${iconEye}</button>
            </div>
          </div>
          <div class="field">
            <label for="setup-token">Setup token</label>
            <input id="setup-token" name="setupToken" type="text" autocomplete="off" required />
            <div class="field-hint">
              ${iconKey} On the server: <code>cat &lt;SETUP_TOKEN_PATH&gt;</code>
            </div>
          </div>
          <p class="error-text" id="setup-error"></p>
          <button type="submit" class="btn btn-primary">Create admin account</button>
        </form>
      </div>
    `;

    root.querySelector("#setup-form").addEventListener("submit", handleSubmit);
    wirePasswordToggles(root);
    root.querySelector("input").focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const errorEl = root.querySelector("#setup-error");
    errorEl.textContent = "";

    const username = root.querySelector("#setup-username").value;
    const password = root.querySelector("#setup-password").value;
    const confirm = root.querySelector("#setup-confirm").value;
    const setupToken = root.querySelector("#setup-token").value.trim();

    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
      errorEl.textContent = "Username must be 3-32 characters: letters, numbers, dots, hyphens, or underscores only";
      return;
    }
    if (password.length < 12) {
      errorEl.textContent = "Password must be at least 12 characters";
      return;
    }
    if (password !== confirm) {
      errorEl.textContent = "Passwords do not match";
      return;
    }

    try {
      const result = await api.setupCreate(username, password, setupToken);
      onSuccess(result);
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong";
    }
  }
}

// Shared by setup.js and dashboard.js - toggles a password input between
// masked and plain text via a button placed right inside the field, since
// typo'd passwords (no email recovery exists) are a real lockout risk and
// letting someone check what they typed is worth more here than blanket
// masking.
export function wirePasswordToggles(scopeEl) {
  scopeEl.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = scopeEl.querySelector(`#${btn.dataset.toggle}`);
      if (!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.innerHTML = showing ? iconEye : iconEyeOff;
      btn.title = showing ? "Show password" : "Hide password";
    });
  });
}
