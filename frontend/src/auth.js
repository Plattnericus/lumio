import { api } from "./api.js";
import { iconBrand } from "./icons.js";

export function mountLogin(root, onSuccess) {
  let stage = "credentials"; // or "totp"

  render();

  function render() {
    root.innerHTML = `
      <div class="login-card glass">
        <div class="brand">${iconBrand}<span>Lumio</span></div>
        <form id="login-form">
          ${
            stage === "credentials"
              ? `
                <div class="field">
                  <label for="username">Username</label>
                  <input id="username" name="username" type="text" autocomplete="username" required />
                </div>
                <div class="field">
                  <label for="password">Password</label>
                  <input id="password" name="password" type="password" autocomplete="current-password" required />
                </div>
              `
              : `
                <div class="field">
                  <label for="totp">Authentication code</label>
                  <input id="totp" name="totp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" required />
                </div>
              `
          }
          <p class="error-text" id="login-error"></p>
          <button type="submit" class="btn btn-primary">${stage === "credentials" ? "Sign in" : "Verify"}</button>
        </form>
      </div>
    `;

    root.querySelector("#login-form").addEventListener("submit", handleSubmit);
    root.querySelector("input")?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const errorEl = root.querySelector("#login-error");
    errorEl.textContent = "";

    try {
      if (stage === "credentials") {
        const username = root.querySelector("#username").value;
        const password = root.querySelector("#password").value;
        const result = await api.login(username, password);

        if (result.totpRequired) {
          stage = "totp";
          render();
          return;
        }
        onSuccess(result);
      } else {
        const token = root.querySelector("#totp").value;
        const result = await api.loginTotp(token);
        onSuccess(result);
      }
    } catch (err) {
      errorEl.textContent = err.message || "Something went wrong";
    }
  }
}
