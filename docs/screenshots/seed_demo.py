#!/usr/bin/env python3
"""Fill a THROWAWAY database with a fictional demo account, for the README screenshots.

Nothing here is real: the companies, roles, notes and links are invented (links use example.com), and the
account is demo@example.com. The script refuses to touch backend/joblogga.db, the development database.

    export DEMO_PASSWORD="$(openssl rand -hex 12)"        # a password for the demo account; never committed
    backend/.venv/bin/python docs/screenshots/seed_demo.py --db /tmp/joblogga-demo.db --reset

then see README.md in this folder for starting the app against that file and taking the shots.

It writes through the real API (an in-process test client), so everything the server does on its own, such as
turning a picked city into readable text, normalising tags and recording the first status-history row, happens
as it would for a person. Only the history timestamps are rewritten afterwards, because the time-in-stage chart
needs stays that really lasted days, and through the API every change would be stamped "now".

Every date is a fixed number of days before one "today" (--today, default the real date), so a re-run gives
the same pictures. The running app judges "overdue" and "this week" by the real clock, so seed and capture on
the same day.
"""

import argparse
import logging
import os
import secrets
import sys
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
DEMO_EMAIL = "demo@example.com"
WEEKLY_GOAL = 6

TECH, PRODUCT, EVENTS = "Tech-focused", "Product-focused", "Events-focused"
NOT_SPECIFIED = None  # no resume version recorded


@dataclass
class Demo:
    company: str
    role: str
    resume: str | None
    ago: int  # applied this many days before "today" (for Saved: when it was saved)
    path: list[tuple[str, int]] = field(default_factory=list)  # (status, days after applying), in order
    status: str = "applied"  # the starting status; "saved" has no applied date
    city: tuple[str, str] | None = None  # (city, state) of a picked place from the real place data
    typed: tuple[str, str] | None = None  # (text, country) for a place typed by hand, with its country
    mode: str | None = None
    salary: tuple[int, int, str] | None = None
    tags: list[str] = field(default_factory=list)
    follow_up: int | None = None  # days from today (negative: overdue)
    rounds: tuple[int, int] | None = None
    notes: str | None = None
    link: str | None = None


def demos(today: date) -> list[Demo]:
    weekday = today.weekday()  # Monday is 0: the three "this week" applications cannot be dated before it
    return [
        # --- this week (the goal card counts these) ---
        Demo("Kestrel Robotics", "Platform Engineer", TECH, 0, city=("Austin", "Texas"), mode="hybrid", salary=(135_000, 155_000, "USD"), tags=["referral"]),
        Demo("Larkspur Health", "Backend Engineer", TECH, min(1, weekday), city=("Portland", "Maine"), mode="hybrid", salary=(120_000, 140_000, "USD")),
        Demo("Copperline Software", "Full-Stack Engineer", PRODUCT, min(2, weekday), city=("Springfield", "Illinois"), mode="in_person"),
        # --- two offers, in different currencies ---
        Demo(
            "Brightwater Labs", "Staff Engineer", TECH, 52, [("screening", 6), ("interview", 15), ("offer", 27)],
            typed=("Remote", "United States"), mode="remote", salary=(168_000, 185_000, "USD"), tags=["dream job", "remote-friendly"],
            rounds=(4, 4), notes="Final round went well. Equity details still to confirm.", link="https://careers.example.com/brightwater/staff-engineer",
        ),
        Demo(
            "Larchmont Analytics", "Data Engineer", TECH, 60, [("screening", 8), ("interview", 19), ("offer", 31)],
            city=("Dublin", "Leinster"), mode="hybrid", salary=(82_000, 95_000, "EUR"), tags=["relocation"],
            rounds=(3, 3), notes="Relocation help offered. Asked about the four-day week.", link="https://careers.example.com/larchmont/data-engineer",
        ),
        # --- in progress ---
        Demo(
            "Marlow & Finch", "Software Engineer II", TECH, 11, [("screening", 4), ("interview", 9)],
            city=("Springfield", "Missouri"), mode="in_person", salary=(105_000, 125_000, "USD"), tags=["follow up"], follow_up=-3, rounds=(2, 3),
            notes="Second interview done. Waiting to hear about the on-site.",
        ),
        Demo("Cobalt Harbor", "Backend Engineer", TECH, 8, [("screening", 4)], city=("Portland", "Oregon"), mode="remote", salary=(125_000, 145_000, "USD")),
        Demo("Driftwood Data", "Platform Engineer", TECH, 12, mode="remote"),
        Demo("Ember & Oak", "Frontend Developer", PRODUCT, 5, [("screening", 3)], city=("Toronto", "Ontario"), mode="hybrid", salary=(95_000, 110_000, "CAD"), follow_up=4),
        Demo("Greywater Media", "Product Engineer", PRODUCT, 9, mode="remote", tags=["startup"]),
        Demo("Harborlight Events", "Event Technologist", EVENTS, 40, [("screening", 5), ("interview", 12)], city=("Austin", "Texas"), mode="in_person", rounds=(1, 2)),
        # --- applied, waiting (some past the 30-day mark) ---
        Demo("Ironbark Systems", "Backend Developer", TECH, 38, follow_up=0, city=("Dublin", "Leinster"), mode="hybrid"),
        Demo("Sable Cloud", "Site Reliability Engineer", TECH, 33, mode="remote", salary=(130_000, 150_000, "USD")),
        Demo("Mosswood Finance", "Frontend Engineer", PRODUCT, 49, city=("Portland", "Oregon"), mode="hybrid"),
        Demo("Pelican Bay Travel", "Software Engineer", PRODUCT, 44, mode="remote"),
        Demo("Summit Loop", "Full-Stack Developer", PRODUCT, 28, city=("Springfield", "Illinois"), mode="in_person", tags=["startup"]),
        Demo("Ashgrove Insurance", "Systems Analyst", NOT_SPECIFIED, 58, city=("Springfield", "Missouri"), mode="in_person"),
        Demo("Lantern Row", "Software Engineer", NOT_SPECIFIED, 46, mode="remote"),
        Demo("Bluff Creek Analytics", "Data Analyst", NOT_SPECIFIED, 27, city=("Toronto", "Ontario"), mode="hybrid"),
        Demo("Tamarind Works", "Operations Engineer", NOT_SPECIFIED, 15, mode="remote"),
        Demo("Pinecone Live", "Production Engineer", EVENTS, 26, city=("Austin", "Texas"), mode="in_person"),
        Demo("Starling Hall", "Systems Developer", EVENTS, 19, city=("Portland", "Maine"), mode="hybrid"),
        # --- closed ---
        Demo("Willowbrook Systems", "Software Engineer", TECH, 74, [("rejected", 12)], city=("Portland", "Oregon"), mode="in_person"),
        Demo("Cedar & Pine", "Backend Developer", PRODUCT, 66, [("screening", 8), ("rejected", 19)], mode="remote"),
        Demo("Tidewater Logistics", "Software Engineer", TECH, 41, [("screening", 9), ("rejected", 20)], city=("Springfield", "Illinois"), mode="hybrid"),
        Demo("Thistle Games", "Gameplay Engineer", TECH, 47, [("rejected", 14)], city=("Toronto", "Ontario"), mode="in_person"),
        Demo("Quillfeather Press", "Web Developer", TECH, 29, [("withdrawn", 10)], mode="remote"),
        Demo("Hollow Oak Studio", "Product Engineer", PRODUCT, 55, [("screening", 10), ("rejected", 22)], city=("Portland", "Maine"), mode="hybrid"),
        Demo("Velvet Ridge Apps", "Product Engineer", PRODUCT, 36, [("rejected", 9)], city=("Lisbon", "Lisbon"), mode="remote"),
        Demo("Foxglove Energy", "Systems Engineer", NOT_SPECIFIED, 35, [("screening", 7), ("rejected", 16)], mode="hybrid"),
        # --- saved, not applied to yet ---
        Demo("Juniper Labs", "Senior Engineer", NOT_SPECIFIED, 4, status="saved", city=("Austin", "Texas"), mode="hybrid", tags=["dream job"], link="https://careers.example.com/juniper/senior-engineer"),
        Demo("Alderwood Tech", "Backend Engineer", NOT_SPECIFIED, 7, status="saved", mode="remote", link="https://careers.example.com/alderwood/backend-engineer"),
        Demo("Rookery Games", "Tools Programmer", NOT_SPECIFIED, 10, status="saved", city=("Toronto", "Ontario"), mode="in_person"),
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", required=True, help="path of the throwaway SQLite file to create")
    parser.add_argument("--today", type=date.fromisoformat, default=date.today(), help="the date everything is dated against (default: today)")
    parser.add_argument("--reset", action="store_true", help="delete the file first if it exists")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    if db_path.parent == BACKEND.resolve() or db_path.name == "joblogga.db":
        sys.exit(f"Refusing to use {db_path}: that is (or sits beside) the development database. Pick a file in /tmp or similar.")
    password = os.environ.get("DEMO_PASSWORD")
    if not password:
        sys.exit('Set DEMO_PASSWORD first, e.g.  export DEMO_PASSWORD="$(openssl rand -hex 12)"')
    if db_path.exists():
        if not args.reset:
            sys.exit(f"{db_path} already exists. Pass --reset to replace it.")
        db_path.unlink()

    # The app reads its settings when it is imported, so point it at the throwaway file first. Seeding signs no
    # token that outlives this process, so a made-up signing key is enough when none is configured.
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ.setdefault("SECRET_KEY", secrets.token_urlsafe(48))
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

    from fastapi.testclient import TestClient
    from sqlalchemy import select, update

    from app.db import SessionLocal, engine
    from app.main import app
    from app.migrations import upgrade_database
    from app.models import Application, City, Country, State, StatusChange, User
    from app.security import hash_password

    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per request is noise here
    upgrade_database(engine)
    now = datetime.now(UTC)

    with SessionLocal() as db:
        db.add(User(email=DEMO_EMAIL, hashed_password=hash_password(password), email_verified_at=now))
        db.commit()

        def city_id(name: str, state: str) -> int:
            found = db.scalars(select(City.id).join(State, City.state_id == State.id).where(City.name == name, State.name == state)).all()
            if len(found) != 1:
                sys.exit(f"Expected one city called {name}, {state} in the place data, found {len(found)}.")
            return found[0]

        def country_id(name: str) -> int:
            return db.scalars(select(Country.id).where(Country.name == name)).one()

        client = TestClient(app)  # no `with`: the app's startup (and its migrations) already ran above
        login = client.post("/auth/login", json={"email": DEMO_EMAIL, "password": password})
        login.raise_for_status()
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        def api(method: str, path: str, body: dict) -> dict:
            res = client.request(method, path, json=body, headers=headers)
            if res.status_code >= 300:
                sys.exit(f"{method} {path} failed: {res.status_code} {res.text}")
            return res.json()

        def stamp(day: date, hour: int) -> datetime:
            return min(datetime.combine(day, time(hour, 20), UTC), now - timedelta(minutes=5))

        for demo in demos(args.today):
            applied = args.today - timedelta(days=demo.ago)
            body: dict = {"company": demo.company, "role": demo.role, "status": demo.status, "work_mode": demo.mode, "tags": demo.tags}
            if demo.status != "saved":
                body["date_applied"] = applied.isoformat()
            if demo.resume:
                body["resume_version"] = demo.resume
            if demo.city:
                body["city_id"] = city_id(*demo.city)
            if demo.typed:
                body["location"], body["country_id"] = demo.typed[0], country_id(demo.typed[1])
            if demo.salary:
                body["salary_min"], body["salary_max"], body["salary_currency"] = demo.salary
            if demo.follow_up is not None:
                body["follow_up_date"] = (args.today + timedelta(days=demo.follow_up)).isoformat()
            if demo.rounds:
                body["interview_round"], body["interview_rounds_total"] = demo.rounds
            body["notes"], body["job_url"] = demo.notes, demo.link
            created = api("POST", "/applications", body)

            for status, _ in demo.path:
                api("PATCH", f"/applications/{created['id']}", {"status": status})

            # Replace the "now" timestamps with the scripted ones, in the order the changes happened.
            moments = [stamp(applied, 9)] + [stamp(applied + timedelta(days=after), 10 + i) for i, (_, after) in enumerate(demo.path)]
            rows = db.scalars(select(StatusChange).where(StatusChange.application_id == created["id"]).order_by(StatusChange.id)).all()
            assert len(rows) == len(moments), (demo.company, len(rows), len(moments))
            for row, moment in zip(rows, moments, strict=True):
                db.execute(update(StatusChange).where(StatusChange.id == row.id).values(changed_at=moment))
            db.execute(update(Application).where(Application.id == created["id"]).values(created_at=moments[0]))
            db.commit()

        api("PATCH", "/auth/me", {"weekly_goal": WEEKLY_GOAL})

    total = len(demos(args.today))
    print(f"Seeded {total} fictional applications for {DEMO_EMAIL} in {db_path} (dated against {args.today}).")


if __name__ == "__main__":
    main()
