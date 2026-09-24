# Joblogga — Project Brief

## What this is
Joblogga is a multi-user, full-stack job application tracker. I'm building this partly because I need it for my own active job search, and partly as a portfolio project to demonstrate full-stack skills (auth, database design, REST APIs, testing, CI/CD, deployment) that aren't yet proven by my existing GitHub projects.

Joblogga is the first app under my personal brand, **DoloCozy** — an umbrella brand/portfolio domain that will host multiple apps I build over time, each as its own subdomain (e.g. joblogga.dolocozy.com). Don't build any "DoloCozy portfolio site" logic into this project — that's a separate, future project. This repo is just Joblogga itself.

## Repo & branding
- **GitHub:** github.com/dolocozy (org account holding all my projects; this specific repo is for Joblogga)
- **Product name:** Joblogga — use this in the README title, page title, and any UI branding (header/logo text, etc.)
- **Domain (later):** joblogga.dolocozy.com — not connected yet, will be added once the app is live on a free hosting subdomain. Don't worry about custom domain/subdomain config yet.
- **License:** MIT — this repo is public

## Tech stack
- **Frontend:** React + TypeScript, Tailwind CSS
- **Backend:** Python (FastAPI) — chosen deliberately to reinforce my AI/data-evaluation background (I work in AI content evaluation) and because Python currently has no backend framework behind it in my portfolio
- **Database:** PostgreSQL (or SQLite for local dev, Postgres in production)
- **Auth:** JWT-based authentication, password hashing (bcrypt), per-user data isolation
- **Testing:** pytest for backend unit tests
- **CI/CD:** GitHub Actions running tests on every push
- **Deployment:** Frontend on Vercel or Netlify (free tier, e.g. joblogga.vercel.app), backend + DB on Render or Railway (free tier)

## Core features
1. **Auth** — sign up, log in, JWT sessions, each user only sees their own data
2. **Application entries** — company, role, job posting link, date applied, resume version used, salary range, location, notes
3. **Status pipeline** — Applied → Screening → Interview → Offer → Rejected → Withdrawn, with status change history
4. **Next-step reminders** — a "follow up by [date]" field per application, plus an "upcoming" view
5. **Filter & search** — by status, company, date range, keyword

## Stand-out features (build after core works)
1. **Dashboard with charts** (Recharts) — response rate, applications per week, status breakdown
2. **Kanban board view** — drag-and-drop between status columns, alongside a plain list view
3. **Resume version tagging** — I have multiple resume versions (tech-focused, events-focused); track which one was used per application
4. **CSV export**

## Working style
- Build incrementally: scaffold project structure and auth first, confirm it works end-to-end (signup → login → protected route) before adding the application CRUD features.
- Write tests alongside each backend feature, not after the fact.
- I want to genuinely understand every part of this (auth flow, schema design, why decisions were made) since I'll need to explain it in interviews — please explain key decisions as you go, not just implement silently.
- Disclose in the README that this was built with Claude Code as a development tool.
- All commits should push to github.com/dolocozy so the full build history lives there.

## First step
Please scaffold the initial project structure (frontend + backend folders, basic FastAPI app with a health-check endpoint, basic React app that calls it, `.gitignore`, `.env.example`, and a README stub titled "Joblogga") so I can confirm the whole pipeline runs locally before we build out auth.
