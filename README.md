# Joblogga

A multi-user job application tracker: log applications, move them through a status pipeline, set follow-up reminders, and see how your search is going.

> **Status:** early scaffolding: health check only. Auth and application CRUD are next.

## Built with Claude Code

This project is built with [Claude Code](https://claude.com/claude-code) as a development tool. I direct the design and review every decision; Claude Code writes much of the code alongside me.

## Tech stack

- **Frontend:** React + TypeScript, Vite, Tailwind CSS
- **Backend:** Python, FastAPI
- **Database:** SQLite for local dev, PostgreSQL in production (planned)
- **Auth:** JWT + bcrypt (planned)
- **Testing / CI:** pytest, GitHub Actions (planned)

## Running locally

**Backend** (http://localhost:8000):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend** (http://localhost:5173):

```bash
cd frontend
npm install
npm run dev
```

The page should show **API: online** when both are running. Copy `.env.example` if you need to change ports or origins.

**Tests:**

```bash
cd backend && pytest
```

## License

MIT
