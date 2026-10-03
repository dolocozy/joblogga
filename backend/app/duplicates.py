"""Spotting an application the user already has: same company and same role.

The match is exact on both, after ignoring case and extra spaces ("acme  CORP" is "Acme Corp"). It is
deliberately not fuzzy: two roles that merely share words ("Data Analyst" and "Senior Data Analyst") are
different applications, and a false warning is more annoying than a missed one. A match only ever WARNS:
there are good reasons to apply twice, so nothing here blocks a save.

Comparison happens in Python, not SQL: SQL's lower() only understands ASCII on SQLite, so "ÉCOLE" and
"école" would match on one database and not the other. A person's own applications number in the hundreds,
so loading one user's rows is cheap.
"""

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Application, ApplicationStatus


def normalize(text: str) -> str:
    """Case-folded, with runs of whitespace collapsed to one space and the ends trimmed."""
    return " ".join(text.casefold().split())


def duplicate_key(company: str, role: str) -> tuple[str, str]:
    return (normalize(company), normalize(role))


@dataclass(frozen=True)
class Existing:
    """What the warning needs to say about an application that already exists."""

    id: int
    company: str
    role: str
    status: ApplicationStatus
    date_applied: date | None
    created_at: datetime


def existing_applications(db: Session, user_id: int) -> dict[tuple[str, str], list[Existing]]:
    """This user's applications grouped by (company, role) key, oldest first within a group.

    Built once and reused, so an import of hundreds of rows does one query, not hundreds.
    """
    groups: dict[tuple[str, str], list[Existing]] = {}
    rows = db.execute(
        select(Application.id, Application.company, Application.role, Application.status, Application.date_applied, Application.created_at)
        .where(Application.user_id == user_id)
        .order_by(Application.created_at, Application.id)
    )
    for row in rows:
        groups.setdefault(duplicate_key(row.company, row.role), []).append(Existing(*row))
    return groups


def find_duplicates(db: Session, user_id: int, company: str, role: str, exclude_id: int | None = None) -> list[Existing]:
    """The user's other applications for the same company and role. `exclude_id` is the one being edited."""
    matches = existing_applications(db, user_id).get(duplicate_key(company, role), [])
    return [m for m in matches if m.id != exclude_id]
