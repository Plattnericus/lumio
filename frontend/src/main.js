import { api } from "./api.js";
import { mountLogin } from "./auth.js";
import { mountSetup } from "./setup.js";
import { mountDashboard } from "./dashboard.js";

const setupView = document.getElementById("view-setup");
const loginView = document.getElementById("view-login");
const dashboardView = document.getElementById("view-dashboard");

async function boot() {
  try {
    const { needsSetup } = await api.setupStatus();
    if (needsSetup) {
      showSetup();
      return;
    }
  } catch {
    // Setup status is a nice-to-have on boot - fall through to the normal
    // session check either way.
  }

  try {
    const session = await api.me();
    showDashboard(session);
  } catch {
    showLogin();
  }
}

function showSetup() {
  loginView.hidden = true;
  dashboardView.hidden = true;
  setupView.hidden = false;
  mountSetup(setupView, showDashboard);
}

function showLogin() {
  setupView.hidden = true;
  dashboardView.hidden = true;
  loginView.hidden = false;
  mountLogin(loginView, showDashboard);
}

function showDashboard(session) {
  setupView.hidden = true;
  loginView.hidden = true;
  dashboardView.hidden = false;
  mountDashboard(dashboardView, session, showLogin);
}

boot();
