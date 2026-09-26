import csv
import io
from collections.abc import Iterable

from app.models import Application

COLUMNS = [
    "Company",
    "Role",
    "Status",
    "Date applied",
    "Follow up by",
    "Job posting link",
    "Location",
    "Work mode",
    "Salary min",
    "Salary max",
    "Resume version",
    "Notes",
    "Status history",
    "Created at",
    "Updated at",
]

# Spreadsheet programs run a cell as a formula when it starts with one of these,
# so a job posting titled "=HYPERLINK(...)" could act on your machine when you
# open the export. A leading apostrophe makes the cell plain text (Excel and
# Sheets hide it). This is the standard OWASP mitigation for "CSV injection".
_FORMULA_STARTERS = ("=", "+", "-", "@", "\t", "\r")


def safe_text(value: str | None) -> str:
    """A text cell, neutralised against spreadsheet formula injection."""
    if not value:
        return ""
    return "'" + value if value.startswith(_FORMULA_STARTERS) else value


def _history(app: Application) -> str:
    """e.g. "applied 2026-03-01; screening 2026-03-08": the timeline, one cell."""
    return "; ".join(f"{h.to_status.value} {h.changed_at.date().isoformat()}" for h in app.history)


def _iso(value) -> str:
    return value.isoformat() if value else ""


def applications_to_csv(applications: Iterable[Application]) -> str:
    out = io.StringIO()
    # \r\n line endings are what the CSV spec (RFC 4180) and Excel expect. The csv
    # module quotes fields containing commas, quotes or newlines.
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(COLUMNS)
    for a in applications:
        writer.writerow(
            [
                safe_text(a.company),
                safe_text(a.role),
                a.status.value,
                _iso(a.date_applied),
                _iso(a.follow_up_date),
                safe_text(a.job_url),
                safe_text(a.location),
                a.work_mode.value if a.work_mode else "",
                "" if a.salary_min is None else a.salary_min,
                "" if a.salary_max is None else a.salary_max,
                safe_text(a.resume_version),
                safe_text(a.notes),
                _history(a),
                _iso(a.created_at),
                _iso(a.updated_at),
            ]
        )
    # The byte-order mark tells Excel the file is UTF-8, so accents and other
    # non-English characters open correctly instead of as garbage.
    return "\ufeff" + out.getvalue()
