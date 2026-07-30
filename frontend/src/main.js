import { api } from "./api.js";
import { mountLogin } from "./auth.js";
import { mountDashboard } from "./dashboard.js";

const loginView = document.getElementById("view-login");
const dashboardView = document.getElementById("view-dashboard");

async function boot() {
  try {
    const session = await api.me();
    showDashboard(session);
  } catch {
    showLogin();
  }
}

function showLogin() {
  dashboardView.hidden = true;
  loginView.hidden = false;
  mountLogin(loginView, showDashboard);
}

function showDashboard(session) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  mountDashboard(dashboardView, session, showLogin);
}

boot();
