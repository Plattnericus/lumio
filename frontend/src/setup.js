import { api } from "./api.js";
import { iconBrand, iconKey } from "./icons.js";

export function mountSetup(root, onSuccess) {
  render();

  function render() {
    root.innerHTML = `
      <div class="login-card wide glass">
        <div class="brand">${iconBrand}<span>Lumio</span></div>
        <p class="lede">Welcome. This is the first time Lumio has been opened - create the
          admin account to get started. You'll be able to add more accounts afterward.</p>
        <form id="setup-form">
          <div class="field">
            <label for="setup-username">Username</label>
            <input id="setup-username" name="username" type="text" autocomplete="username" required />
          </div>
          <div class="field">
            <label for="setup-password">Password</label>
            <input id="setup-password" name="password" type="password" autocomplete="new-password" minlength="12" required />
            <div class="field-hint">At least 12 characters.</div>
          </div>
          <div class="field">
            <label for="setup-confirm">Confirm password</label>
            <input id="setup-confirm" name="confirm" type="password" autocomplete="new-password" required />
          </div>
          <div class="field">
            <label for="setup-token">Setup token</label>
            <input id="setup-token" name="setupToken" type="text" autocomplete="off" required />
            <div class="field-hint">
              ${iconKey} One-time token printed when Lumio was installed. On the server: <code>cat &lt;SETUP_TOKEN_PATH&gt;</code>
            </div>
          </div>
          <p class="error-text" id="setup-error"></p>
          <button type="submit" class="btn btn-primary">Create admin account</button>
        </form>
      </div>
    `;

    root.querySelector("#setup-form").addEventListener("submit", handleSubmit);
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
