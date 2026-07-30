# Lumio

A self-hosted personal cloud for photos, PDFs, Word and PowerPoint files —
plus a Garmin Connect IQ companion app to browse it from your wrist. No
Authentik, no Cloudflare Tunnel, no third-party identity provider: it's just
this app, served straight off a VPS's public IP.

## Features

- Own login, own sessions — no external auth dependency
- Drag-and-drop upload with real file-type validation (magic bytes, not
  extensions)
- Grid view with image thumbnails and type icons for documents
- Download and delete, filterable by file type
- Garmin watch app: pair once, then browse and view your photos on-device
- TOTP two-factor authentication
- Real TLS via a Let's Encrypt certificate issued directly for the server's
  IP address (no domain required)

## Tech stack

| Component | Choice |
|---|---|
| `backend/` | Node.js + Express, JSON API only |
| Database | SQLite via `better-sqlite3` |
| `frontend/` | Vanilla JS/HTML/CSS, no framework, no build server |
| `garmin-app/` | Connect IQ SDK, Monkey C |
| Reverse proxy / TLS | nginx |
| Tests | Vitest (backend) |
| CI/CD | GitHub Actions |
| Releases | Conventional Commits + release-please |

## Repo structure & branch strategy

```
lumio/
├── backend/            # Express API, SQLite, auth, uploads
├── frontend/            # Static dashboard
├── garmin-app/          # Connect IQ project
├── .github/workflows/    # CI, release, deploy
├── CLAUDE.md
└── README.md
```

- `main` — protected, always deployable, the only branch releases/deploys are
  cut from.
- `backend`, `frontend`, `garmin-app` — long-lived per-component branches,
  merged into `main` via PR once CI is green.

See [CLAUDE.md](CLAUDE.md) for the full standing rules.

## Prerequisites

- Node.js (see `backend/.nvmrc` once added) and npm
- A Connect IQ SDK install + simulator for `garmin-app/`
- nginx and certbot ≥ 5.4 on the deploy target
- `gh` CLI for repo/release operations (optional, convenience only)

## Local setup

### backend/

```bash
cd backend
cp .env.example .env   # fill in real values, never commit .env
npm install
npm run dev
```

### frontend/

```bash
cd frontend
npm install
npm run dev   # served separately in dev; nginx serves frontend/dist in prod
```

### garmin-app/

Open `garmin-app/` in the Connect IQ SDK / VS Code plugin and run it against
the Vivoactive 6 simulator. Before it can reach your server, set two app
settings (Connect IQ simulator: App Settings, or on a real watch: the
widget's settings in Garmin Connect Mobile) - neither is hardcoded:

- **Lumio server URL** - e.g. `https://your-server:8444`
- **Pairing code** - generated from the dashboard's "Pair Garmin watch"
  button, then press Select on the watch to exchange it for a token

The app stores the resulting device token locally and won't ask for the
code again unless that storage is cleared.

## Environment variables

All of these live in `backend/.env` (see `backend/.env.example` for the full,
value-free template — never commit the real file).

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | Port the API listens on (bound to `127.0.0.1` only) |
| `SESSION_SECRET` | Random secret for signing session cookies |
| `DB_PATH` | Path to the SQLite database file |
| `UPLOAD_DIR` | Path where uploaded files are stored |
| `MAX_UPLOAD_MB` | Upload size limit in megabytes |
| `LOGIN_RATE_LIMIT_MAX` | Failed login attempts allowed before lockout |
| `PAIRING_CODE_TTL_MINUTES` | How long a Garmin pairing code stays valid |

## CI/CD & release process

- Every PR runs `.github/workflows/ci.yml`: a `dorny/paths-filter` job
  decides which of `backend`/`frontend`/`garmin-app` actually changed, then
  only those jobs run (lint, tests, `npm audit`). Merging into `main`
  requires this to pass (branch protection).
- `release-please` watches `main`'s Conventional Commit history and opens a
  release PR with a generated `CHANGELOG.md`. Merging that PR cuts a GitHub
  Release + tag.
- `deploy.yml` triggers on `release: published`: SSH onto the VPS, checkout
  the tag, `npm ci --production` (backend) and a static rebuild (frontend),
  restart the service, then poll `/api/health`. A failed health check rolls
  back to the previously deployed commit automatically and fails the
  workflow — a bad release never stays live.

### Required GitHub Actions secrets

None of these are hardcoded anywhere in the workflows - set them under
the repo's Settings → Secrets and variables → Actions.

| Secret | Purpose |
|---|---|
| `RELEASE_PLEASE_TOKEN` | A PAT (not the default `GITHUB_TOKEN`) for `release-please-action`. Required because a release created with the default token doesn't fire the `release: published` event `deploy.yml` waits for. |
| `DEPLOY_SSH_KEY` | Private half of the deploy keypair (generated on the VPS - see Deployment below). |
| `DEPLOY_SSH_USER` | The account the deploy key logs in as on the VPS. |
| `VPS_HOST` | The VPS's public IP or hostname. |
| `GARMIN_USERNAME` / `GARMIN_PASSWORD` | Your own Garmin Connect developer account, used only to download the Connect IQ SDK in the `garmin` CI job. Without these the compile-check step fails at the download - that's expected until they're set, not a sign the app itself is broken. |

## Deployment

Deployed to `/root/lumio` on the VPS, reachable at
`https://<vps-ip>:8444` (port 8444, not 8443 — see CLAUDE.md for why).
nginx serves `frontend/dist` as static files and proxies `/api/*` to the
Node process on `127.0.0.1`. The Node process itself never binds to a public
interface.

## Certificate renewal

TLS uses a Let's Encrypt certificate issued directly for the server's IP
address (GA since January 2026), valid for ~160 hours. A systemd timer runs
`certbot renew` twice daily; a separate check alerts if the certificate has
less than 48 hours left. This is a hard requirement, not a one-time setup
step — see CLAUDE.md.

## Backup & restore

`npm run backup` (from `backend/`) snapshots the database and upload
directory into `backend/data/backups/`, rotating anything older than 7
days. It uses SQLite's own online backup API rather than a plain file
copy, which isn't safe against a live WAL-mode database.

Run it daily via a systemd timer on the VPS - a oneshot service calling
`npm run backup` in `/root/lumio/backend`, triggered by a timer with
`OnCalendar=daily`, the same pattern as the certificate-check timer.

Override the destination or retention window with `BACKUP_DIR` and
`BACKUP_RETENTION_DAYS` env vars.

**Restore:** stop the service, copy a backed-up `.sqlite` file back to the
path in `DB_PATH`, copy the matching `uploads-<timestamp>/` snapshot back to
`UPLOAD_DIR`, restart the service.

**Offsite backup target: not yet decided — TODO.** A VPS failure currently
takes the local rotation down with it. Pick a destination (a second machine,
object storage, etc.) and this gets wired in as a follow-up.

## Security notes

- Argon2id password hashing, no open registration — the one account is
  created via a setup script.
- Sessions: `httpOnly`, `secure`, `sameSite=strict` cookies; CSRF protection
  on all state-changing routes.
- Rate limiting + lockout on `/api/login`, with a generic error message that
  never reveals whether a username exists.
- Uploads are validated by magic bytes against an allow-list (jpg, png,
  webp, pdf, docx, pptx), size-limited, stored under randomized filenames,
  and only ever served through an authenticated endpoint — never mounted
  statically.
- `fail2ban` watches both sshd and repeated app login failures.

## License

Private project — no license granted for reuse.
