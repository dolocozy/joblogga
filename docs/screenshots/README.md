# README screenshots

The pictures in the project README are taken from a **demo account with made-up data**, never from a real database. Everything in them is fictional: the companies, roles, notes and links (which use `example.com`), and the account itself (`demo@example.com`).

| File | What it is |
| --- | --- |
| `seed_demo.py` | Fills a throwaway SQLite file with the demo account: 30 applications and 3 saved jobs, with a spread of statuses, three resume versions (plus one with only 3 applications, so "too few to judge" shows), tags, a weekly goal part-way met, an overdue follow-up, two offers in different currencies and two pairs of same-named cities (Springfield, Portland). |
| `capture.mjs` | Takes each shot in both themes with headless Chrome. No npm packages needed. |
| `compose_hero.py` | Joins the light and dark list shots into the README's top picture (needs Pillow). |
| `optimize.py` | Shrinks every PNG here to a 256-colour palette, about 60% smaller (needs Pillow). |

## Taking them again

Do this after a release that changes how a page looks. It needs Node 22 or newer, Google Chrome, and a Python environment with Pillow (`pip install pillow`).

Dates in the demo data are a fixed number of days before one "today" (the real date unless you pass `--today`), and the app judges "overdue" and "this week" by the real clock, so seed and capture on the same day.

```bash
# 1. A password for the demo account. It is only for a scratch database; it is never committed.
export DEMO_PASSWORD="$(openssl rand -hex 12)"

# 2. Seed a throwaway database (pick any path that is not backend/joblogga.db; the script refuses that one).
backend/.venv/bin/python docs/screenshots/seed_demo.py --db /tmp/joblogga-demo.db --reset

# 3. Run the API against it, and the frontend, each in its own terminal.
cd backend && DATABASE_URL=sqlite:////tmp/joblogga-demo.db .venv/bin/uvicorn app.main:app --port 8000
cd frontend && npm run dev

# 4. Take the shots (writes the PNGs into this folder), then tidy them.
node docs/screenshots/capture.mjs
python3 docs/screenshots/compose_hero.py
python3 docs/screenshots/optimize.py
```

`ONLY=dashboard,offers node docs/screenshots/capture.mjs` redoes just those shots. `capture.mjs` refuses to run unless the account it logs in as is `demo@example.com`, so it cannot photograph anyone's real data by being pointed at the wrong server. Look at every picture before committing: no half-loaded charts, nothing clipped, the right theme in each.

## Sizes and choices

- Pages are shot at 1280 CSS pixels wide, at 1.5x so text stays sharp (1920 pixels in the file). The Kanban board is the exception, at 1340: it is a strip of nine columns that scrolls sideways, and 1340 ends the picture exactly after the sixth full column instead of cutting one in half.
- The list and board are the top of the page, not the whole page. The dashboard, offers and the landing page's hero are shown whole. On the dashboard the resume-version card is shown as its table, because that is where a version with too few applications is labelled "too few to judge".
- Each page is shot in light and dark with the theme set explicitly (the Theme button's saved choice), not left to the system preference. The landing page has one version, since its two themes differ only in colour.
