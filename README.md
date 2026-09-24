# Joblogga

A multi-user job application tracker: log applications, move them through a status pipeline, set follow-up reminders, and see how your search is going.

> **Status:** early development. Auth and application tracking (create, edit, delete, status history, search/filter, follow-up reminders) work. A dashboard with response rate and charts is built. Kanban view and CSV export are next.

## Built with Claude Code

This project is built with [Claude Code](https://claude.com/claude-code) as a development tool. I direct the design and review every decision; Claude Code writes much of the code alongside me.

## Tech stack

- **Frontend:** React + TypeScript, Vite, Tailwind CSS, Recharts, self-hosted fonts (Newsreader, Hanken Grotesk, IBM Plex Mono)
- **Backend:** Python, FastAPI
- **Database:** SQLAlchemy 2.0; SQLite for local dev, PostgreSQL in production (planned)
- **Auth:** JWT (PyJWT) + bcrypt
- **Testing / CI:** pytest; Vitest, Testing Library and MSW; GitHub Actions runs both on every push

## Running locally

**Backend** (http://localhost:8000):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# create backend/.env with a random SECRET_KEY (see .env.example):
echo "SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" > .env
uvicorn app.main:app --reload
```

**Frontend** (http://localhost:5173):

```bash
cd frontend
npm install
npm run dev
```

Open the app, sign up, and you should land on a page showing your email and **API: online**. See `.env.example` for all settings.

**Tests:**

```bash
cd backend && pytest      # API tests (in-memory SQLite)
cd frontend && npm test  # UI tests (Vitest + Testing Library, API mocked with MSW)
```

## Design

The interface is styled as a logbook: warm paper, dark ink, pine green for actions, brick red for trouble, and a highlighter yellow behind overdue follow-ups. Titles are set in a serif, dates and numbers in a monospace so columns line up like a ledger. The applications list is a ruled ledger with a small stage meter per status, not a stack of cards.

The rules that keep it from looking generic are enforced by a test (`frontend/src/design.test.ts`): no middle-dot separators, no arrows on links, no all-caps tracked labels, no default Tailwind palette colors, two border radii only, and no shadows except the chart tooltip. All text and background pairings were contrast-checked against WCAG.

## Pages

| Path | Who sees it |
| --- | --- |
| `/` | Landing page with the login form (logged in: redirects to `/applications`) |
| `/login`, `/signup` | Stand-alone forms |
| `/applications`, `/applications/new`, `/applications/:id` | Your applications |
| `/dashboard` | Response rate and charts |

Visiting a protected page while logged out sends you to `/`, and logging in returns you to the page you asked for.

Forms validate inline: a message appears under the field as you type (after you've touched it), instead of the browser's native popup. The server re-checks everything.

## API overview

Interactive docs are at http://localhost:8000/docs when the backend is running.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/signup`, `/auth/login` | Create account / get a token |
| GET | `/auth/me` | Current user |
| POST | `/applications` | Create (records the initial status) |
| GET | `/applications` | List; filters `status`, `company`, `q`, `date_from`, `date_to`; `limit`/`offset` |
| GET | `/applications/export.csv` | Every application as a CSV file (your backup); includes status history; ignores list filters |
| GET | `/applications/upcoming` | Open applications with a follow-up overdue or due within `days` (default 7) |
| GET / PATCH / DELETE | `/applications/{id}` | Read (with status history) / partial update / delete |
| GET | `/stats` | Dashboard numbers: totals, per-status counts, response rate, weekly series; `weeks=N` limits everything to the last N weeks (omit for all time) |

The CSV neutralizes cells that start with `=`, `+`, `-` or `@` (a leading apostrophe) so a hostile job posting cannot run as a formula when the file is opened in Excel, and starts with a UTF-8 marker so accents open correctly.

Every `/applications` query is scoped to the logged-in user; another user's application returns 404.

## Data model

- `users`: email (unique), bcrypt hash.
- `applications`: belongs to a user; company, role, job link, date applied, resume version, salary min/max, location, notes, current status, follow-up date.
- `status_changes`: append-only log (`from_status`, `to_status`, timestamp) written whenever an application's status changes, so the full timeline is kept.

## Dashboard

- **Response rate** = (Screening + Interview + Offer + Rejected) ÷ (all applications − Withdrawn). A rejection is a response; a withdrawal is your decision, so it is excluded from both sides of the ratio. When nothing is eligible the rate is "no data" (shown as a dash), not 0%.
- Status is each application's *current* status, so one that reached Interview and was then withdrawn counts as withdrawn.
- One time-range filter scopes every number and chart, so they always agree. Each chart has a "View as table" twin so no value depends on hovering.
- The charts are loaded on demand, so the login and list pages don't download the charting library.

## Rate limiting

Failed logins are limited three ways, and signups per address:

| Limit | Allowance | Why |
| --- | --- | --- |
| Per address and account | 5 failures / 15 min | Stops guessing at one account, without letting an attacker lock the real owner out from another address |
| Per account, any address | 20 failures / hour | Stops guessing spread over many addresses |
| Per address, any account | 50 failures / 15 min | Stops one address trying many accounts |
| Signups per address | 10 / hour | Slows account spam |

Only failures count, unknown emails count the same as real ones (so the limit reveals nothing), and a locked caller is refused before the password is even checked. Refusals return `429` with a `Retry-After` header and a plain-language message.

Limits are held in the API process's memory: fine for one server, reset on restart, and would move to Redis or the database to run several instances. Knowing each visitor's real address behind a host's proxies is the hard part, and it was measured, not assumed. On Render a request passes Cloudflare and then Render's load balancer, and a forged `X-Forwarded-For` becomes the server's connection address, so that address is never trusted. The API uses `CF-Connecting-IP` (Cloudflare rejects or overwrites a forged one), falls back to counting `X-Forwarded-For` three entries from the right (the left side is written by the client), and if neither works puts everyone in one shared, stricter bucket instead of trusting anything forgeable. Settings: `TRUSTED_CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS`.

## Auth design

- **Passwords** are hashed with bcrypt (per-password random salt); plaintext is never stored, and responses never include the hash.
- **Login** returns a short-lived JWT (default 60 min) signed with `SECRET_KEY`. The client sends it as `Authorization: Bearer <token>`.
- **Protected routes** use the `get_current_user` dependency, which verifies the signature and expiry (pinned algorithm) and loads the user. Data routes will filter by that user's id, which is how per-user isolation is enforced.
- Wrong email and wrong password return the identical error, and unknown emails still run a bcrypt check, so neither the message nor the response time reveals which emails are registered.
- The frontend keeps the token in `localStorage` and re-validates it against `/auth/me` on load. `localStorage` is readable by page scripts (XSS); an httpOnly cookie would avoid that at the cost of CSRF handling.

## Database migrations

The schema lives in versioned migration files (`backend/alembic/versions`), applied automatically when the API starts.

**Changing the schema:**

```bash
cd backend && source .venv/bin/activate
# 1. edit the model in app/models.py
# 2. generate a migration from the difference, then READ and edit it
alembic revision --autogenerate -m "add priority to applications"
# 3. run the tests: they build the schema from the migrations and fail if it differs from the models
pytest
```

Rules that keep production data safe:

- **Migrations never import app code.** They use plain SQLAlchemy types, so an old migration keeps meaning the same thing however the models change. (Autogenerate writes `app.db.UtcDateTime`; replace it with `sa.DateTime(timezone=True)`.)
- **Autogenerate is a draft.** It cannot see renames (it drops and re-adds) or data changes. Review every file.
- **Make changes backward compatible.** During a deploy the old version keeps serving while the new one migrates, so new columns must be nullable or have defaults, and removing or renaming something takes two releases: add the new thing and deploy, then remove the old thing later.
- **Export your data first** (Export CSV) before a risky change: Neon's free plan only keeps about 6 hours of history.

**How startup behaves:** a new database is built from the migrations. A database made by the older startup code (tables, no migration history) is checked against the expected schema and, if it matches, simply marked as being at the baseline, so no data is touched; if it does not match, startup stops instead of guessing. The whole upgrade is one transaction with a lock, so a failure on Postgres leaves the database exactly as it was, and the host keeps serving the previous version.

## Deployment

| Piece | Where | Config |
| --- | --- | --- |
| Frontend | Vercel (root directory `frontend`) | `frontend/vercel.json`, env `VITE_API_URL` |
| API | Render web service | `render.yaml` (Blueprint), envs `DATABASE_URL`, `CORS_ORIGINS`, generated `SECRET_KEY` |
| Database | Neon Postgres | connection string goes in Render's `DATABASE_URL` |

Notes:
- The database is on Neon, not Render, because Render's free Postgres expires after 30 days.
- Render deploys only when the GitHub CI checks pass (`autoDeployTrigger: checksPass`).
- Render's free web service sleeps after 15 idle minutes and takes about a minute to wake. The landing page pings the API on load so it is usually awake by the time you log in, and a slow login explains itself.
- CI runs the backend tests on both SQLite and a real Postgres service, since production uses Postgres.
- The database schema is managed with Alembic migrations, applied automatically when the API starts (see below).

## License

MIT
