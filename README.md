# Joblogga

A multi-user job application tracker: log applications, move them through a status pipeline, set follow-up reminders, and see how your search is going.

> **Status:** early development. Auth and application tracking (create, edit, delete, status history, search/filter, follow-up reminders) work. Dashboard charts, Kanban view and CSV export are next.

## Built with Claude Code

This project is built with [Claude Code](https://claude.com/claude-code) as a development tool. I direct the design and review every decision; Claude Code writes much of the code alongside me.

## Tech stack

- **Frontend:** React + TypeScript, Vite, Tailwind CSS
- **Backend:** Python, FastAPI
- **Database:** SQLAlchemy 2.0; SQLite for local dev, PostgreSQL in production (planned)
- **Auth:** JWT (PyJWT) + bcrypt
- **Testing / CI:** pytest, GitHub Actions (planned)

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
cd backend && pytest
```

## API overview

Interactive docs are at http://localhost:8000/docs when the backend is running.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/signup`, `/auth/login` | Create account / get a token |
| GET | `/auth/me` | Current user |
| POST | `/applications` | Create (records the initial status) |
| GET | `/applications` | List; filters `status`, `company`, `q`, `date_from`, `date_to`; `limit`/`offset` |
| GET | `/applications/upcoming` | Open applications with a follow-up overdue or due within `days` (default 7) |
| GET / PATCH / DELETE | `/applications/{id}` | Read (with status history) / partial update / delete |

Every `/applications` query is scoped to the logged-in user; another user's application returns 404.

## Data model

- `users`: email (unique), bcrypt hash.
- `applications`: belongs to a user; company, role, job link, date applied, resume version, salary min/max, location, notes, current status, follow-up date.
- `status_changes`: append-only log (`from_status`, `to_status`, timestamp) written whenever an application's status changes, so the full timeline is kept.

## Auth design

- **Passwords** are hashed with bcrypt (per-password random salt); plaintext is never stored, and responses never include the hash.
- **Login** returns a short-lived JWT (default 60 min) signed with `SECRET_KEY`. The client sends it as `Authorization: Bearer <token>`.
- **Protected routes** use the `get_current_user` dependency, which verifies the signature and expiry (pinned algorithm) and loads the user. Data routes will filter by that user's id, which is how per-user isolation is enforced.
- Wrong email and wrong password return the identical error, and unknown emails still run a bcrypt check, so neither the message nor the response time reveals which emails are registered.
- The frontend keeps the token in `localStorage` and re-validates it against `/auth/me` on load. `localStorage` is readable by page scripts (XSS); an httpOnly cookie would avoid that at the cost of CSRF handling.

## License

MIT
