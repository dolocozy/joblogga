"""Importing applications from a CSV file: the reverse of the export.

A file made by the export imports back cleanly, which is the sanity check. Other spreadsheets work too if
their headers are recognisable ("Employer", "Job title", "Applied"...). The principle for a messy file is
"import what can be imported, and say exactly what was not":

- a row without a company or a role is skipped and reported (it cannot be an application);
- a missing optional column or cell just leaves the field empty;
- a value that does not make sense (a date nobody can read, a salary that is not a number) is left empty and
  reported as an adjustment, never guessed at and never allowed to sink the row;
- blank rows are ignored without comment;
- a row that duplicates an application the user already has, or an earlier row of the same file, is skipped
  and reported (unless the user chose to keep duplicates), so importing the same file twice adds nothing.
"""

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.duplicates import duplicate_key, existing_applications, normalize
from app.geo import place_label, search_key
from app.models import Application, ApplicationStatus, City, Country, State, StatusChange, WorkMode
from app.schemas import MAX_ROUNDS, ApplicationCreate, check_rounds, check_salary_range

MAX_BYTES = 2_000_000
MAX_ROWS = 1000

# Header (normalised: case-folded, spaces collapsed) -> the field it fills. The first group is exactly what the export writes.
HEADERS: dict[str, str] = {
    **{h: f for h, f in [
        ("company", "company"), ("role", "role"), ("status", "status"), ("date applied", "date_applied"),
        ("follow up by", "follow_up_date"), ("job posting link", "job_url"), ("location", "location"),
        ("country", "country"), ("state", "state"), ("city", "city"), ("work mode", "work_mode"),
        ("salary min", "salary_min"), ("salary max", "salary_max"), ("resume version", "resume_version"),
        ("interview round", "interview_round"), ("interview rounds total", "interview_rounds_total"),
        ("notes", "notes"), ("status history", "history"),
    ]},
    # Friendly spellings other spreadsheets tend to use.
    "employer": "company", "organisation": "company", "organization": "company",
    "job title": "role", "title": "role", "position": "role",
    "applied": "date_applied", "applied on": "date_applied", "date": "date_applied",
    "follow up": "follow_up_date", "follow-up": "follow_up_date", "follow up date": "follow_up_date", "follow-up date": "follow_up_date",
    "link": "job_url", "url": "job_url", "job link": "job_url", "job url": "job_url", "posting": "job_url", "job posting": "job_url",
    "resume": "resume_version", "cv": "resume_version", "cv version": "resume_version",
    "min salary": "salary_min", "salary from": "salary_min", "max salary": "salary_max", "salary to": "salary_max",
    "remote": "work_mode", "on-site": "work_mode", "arrangement": "work_mode",
    "note": "notes", "comments": "notes",
}

# Columns the export writes that an import deliberately does not read: the new rows get their own timestamps.
IGNORED_HEADERS = {"created at", "updated at"}

_FORMULA_STARTERS = ("=", "+", "-", "@", "\t", "\r")

STATUS_WORDS = {normalize(s.value.replace("_", " ")): s for s in ApplicationStatus}
WORK_MODE_WORDS = {
    "remote": WorkMode.REMOTE,
    "hybrid": WorkMode.HYBRID,
    "in person": WorkMode.IN_PERSON,
    "in-person": WorkMode.IN_PERSON,
    "onsite": WorkMode.IN_PERSON,
    "on-site": WorkMode.IN_PERSON,
    "on site": WorkMode.IN_PERSON,
}

_ISO_DATE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$")
_HISTORY_ENTRY = re.compile(r"^([a-z_]+) (\d{4}-\d{2}-\d{2})$")


class ImportFileError(ValueError):
    """The whole file is unusable (not a CSV, empty, no Company or Role column, too big)."""


@dataclass
class RowNote:
    row: int  # the row number as a spreadsheet shows it: the header is row 1, the first application row 2
    reason: str


@dataclass
class ImportResult:
    total_rows: int = 0  # rows after the header, blank ones included
    blank_rows: int = 0
    added: int = 0
    skipped: list[RowNote] = field(default_factory=list)  # could not be imported at all
    duplicates: list[RowNote] = field(default_factory=list)  # skipped because they repeat an application
    adjusted: list[RowNote] = field(default_factory=list)  # imported, but a value was left empty or changed


def decode(data: bytes) -> str:
    """UTF-8 (with or without the marker the export writes), else Windows-1252, which is what Excel
    saves when it is not asked for UTF-8. Never fails, so an accented name is not a reason to refuse a file."""
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _clean(value: str | None) -> str:
    return (value or "").strip()


def _text(value: str | None) -> str | None:
    """A text cell: trimmed, blank is None, and the apostrophe the export puts before a '=' or '+' is taken off again."""
    text = _clean(value)
    if len(text) > 1 and text[0] == "'" and text[1] in _FORMULA_STARTERS:
        text = text[1:]
    return text or None


def parse_date(value: str) -> date | None:
    """YYYY-MM-DD (also with slashes, or followed by a time). Anything else, such as 3/4/2026, is not guessed at:
    it could be March 4th or April 3rd."""
    match = _ISO_DATE.match(value.strip())
    if not match:
        return None
    try:
        return date(int(match[1]), int(match[2]), int(match[3]))
    except ValueError:
        return None


def parse_int(value: str) -> int | None:
    """"90000", "90,000", "$90,000", "90000.00": a whole non-negative number, else None."""
    cleaned = re.sub(r"[,$£€\s]", "", value)
    match = re.fullmatch(r"(\d+)(?:\.0+)?", cleaned)
    return int(match[1]) if match else None


def read_rows(text: str) -> tuple[dict[int, str], list[tuple[int, dict[str, str]]]]:
    """The recognised columns, and each data row as {field: raw cell}, with its row number."""
    # Excel in many countries saves with semicolons, and "export as tab-separated" is common: use whichever
    # separator the header line has most of. (A sniffer guesses from the data and gets notes with a ';' in them wrong.)
    header_line = text.split("\n", 1)[0]
    delimiter = max((",", ";", "\t"), key=header_line.count) if any(d in header_line for d in ",;\t") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        header = next(reader)
    except StopIteration:
        raise ImportFileError("The file is empty.") from None
    columns: dict[int, str] = {}
    for index, name in enumerate(header):
        target = HEADERS.get(normalize(name))
        if target and target not in columns.values():  # the first of two columns with one meaning wins
            columns[index] = target
    wanted = set(columns.values())
    if "company" not in wanted or "role" not in wanted:
        missing = " and ".join(n for n, f in (("Company", "company"), ("Role", "role")) if f not in wanted)
        raise ImportFileError(f"The first row must name the columns, and the file needs a {missing} column. Export your applications to see the expected layout.")
    rows: list[tuple[int, dict[str, str]]] = []
    for number, record in enumerate(reader, start=2):
        rows.append((number, {columns[i]: cell for i, cell in enumerate(record) if i in columns}))
    return columns, rows


class PlaceMatcher:
    """Turns the Country, State and City cells back into dataset rows, when they name real ones.

    Looked up by name (or ISO code, for the country), so a file exported from the app restores the picked
    place exactly. Anything that does not match uniquely stays as typed text: nothing is guessed.
    """

    def __init__(self, db: Session):
        self.db = db
        self._countries: dict[str, Country] | None = None
        self._cities: dict[tuple[int, str, str], City | None] = {}

    def country(self, name: str) -> Country | None:
        if self._countries is None:
            self._countries = {}
            for c in self.db.scalars(select(Country)):
                for key in (c.name, c.iso2, c.iso3):
                    if key:
                        self._countries.setdefault(normalize(key), c)
        return self._countries.get(normalize(name))

    def city(self, country: Country, state: str, name: str) -> City | None:
        key = (country.id, normalize(state), search_key(name))
        if key not in self._cities:
            query = select(City).join(State, State.id == City.state_id).where(City.country_id == country.id, City.search_name == key[2])
            matches = list(self.db.scalars(query.order_by(City.population.desc().nulls_last(), City.id)))
            if key[1]:
                matches = [c for c in matches if normalize(c.state.name) == key[1]]
            # Without a state, the name must belong to one state only: "Springfield" alone is ambiguous.
            ambiguous = not key[1] and len({c.state_id for c in matches}) > 1
            self._cities[key] = matches[0] if matches and not ambiguous else None
        return self._cities[key]


def _history(raw: str, status: ApplicationStatus) -> list[tuple[ApplicationStatus, datetime]] | None:
    """The export's "applied 2026-03-01; interview 2026-03-08" rebuilt into dated status changes, or None if it
    cannot be trusted (not that format, an unknown status, or it does not end at the row's own status)."""
    entries: list[tuple[ApplicationStatus, datetime]] = []
    for part in raw.split(";"):
        match = _HISTORY_ENTRY.match(part.strip())
        if not match or match[1] not in {s.value for s in ApplicationStatus}:
            return None
        day = parse_date(match[2])
        if day is None:
            return None
        entries.append((ApplicationStatus(match[1]), datetime(day.year, day.month, day.day, 12, tzinfo=UTC)))
    return entries if entries and entries[-1][0] == status else None


def _is_blank(cells: dict[str, str]) -> bool:
    return not any(_clean(v) for v in cells.values())


def import_csv(db: Session, user_id: int, data: bytes, skip_duplicates: bool = True) -> ImportResult:
    """Import `data`, adding every importable row to `user_id`'s applications in one transaction (the caller commits)."""
    if len(data) > MAX_BYTES:
        raise ImportFileError(f"The file is too big (over {MAX_BYTES // 1_000_000} MB). Split it into smaller files.")
    text = decode(data)
    _, rows = read_rows(text)
    result = ImportResult(total_rows=len(rows))
    if len(rows) > MAX_ROWS:
        raise ImportFileError(f"The file has {len(rows)} rows; at most {MAX_ROWS} can be imported at once. Split it into smaller files.")

    existing = existing_applications(db, user_id)
    in_file: dict[tuple[str, str], int] = {}  # company and role of rows added so far -> the row number, to catch repeats inside the file
    places = PlaceMatcher(db)
    for number, cells in rows:
        if _is_blank(cells):
            result.blank_rows += 1
            continue

        def note(message: str) -> None:
            result.adjusted.append(RowNote(number, message))

        company, role = _text(cells.get("company")), _text(cells.get("role"))
        if not company and not role:
            result.skipped.append(RowNote(number, "missing company and role"))
            continue
        if not company:
            result.skipped.append(RowNote(number, "missing company name"))
            continue
        if not role:
            result.skipped.append(RowNote(number, "missing role"))
            continue

        key = duplicate_key(company, role)
        repeats_existing, repeats_file = key in existing, in_file.get(key)
        if skip_duplicates and (repeats_existing or repeats_file):
            result.duplicates.append(
                RowNote(number, f"{company}, {role} is already in your applications" if repeats_existing else f"{company}, {role} repeats row {repeats_file} of this file")
            )
            continue

        status = ApplicationStatus.APPLIED
        raw_status = _clean(cells.get("status"))
        if raw_status:
            parsed = STATUS_WORDS.get(normalize(raw_status.replace("_", " ").replace("-", " ")))
            if parsed:
                status = parsed
            else:
                note(f"status '{raw_status}' is not one of the statuses, so it was set to Applied")

        def read_date(field_name: str, label: str) -> date | None:
            raw = _clean(cells.get(field_name))
            if not raw:
                return None
            parsed = parse_date(raw)
            if parsed is None:
                note(f"{label} '{raw}' could not be read (use YYYY-MM-DD), so it was left empty")
            return parsed

        date_applied = read_date("date_applied", "date applied")
        follow_up = read_date("follow_up_date", "follow-up date")

        def read_number(field_name: str, label: str) -> int | None:
            raw = _clean(cells.get(field_name))
            if not raw:
                return None
            parsed = parse_int(raw)
            if parsed is None:
                note(f"{label} '{raw}' is not a whole number, so it was left empty")
            return parsed

        salary_min, salary_max = read_number("salary_min", "salary min"), read_number("salary_max", "salary max")
        try:
            check_salary_range(salary_min, salary_max)
        except ValueError:
            note("the minimum salary is above the maximum, so both were left empty")
            salary_min = salary_max = None

        round_, total = read_number("interview_round", "interview round"), read_number("interview_rounds_total", "interview rounds total")
        for label, value in (("interview round", round_), ("interview rounds total", total)):
            if value is not None and not 1 <= value <= MAX_ROUNDS:
                note(f"{label} {value} is outside 1 to {MAX_ROUNDS}, so it was left empty")
                if label == "interview round":
                    round_ = None
                else:
                    total = None
        try:
            check_rounds(round_, total)
        except ValueError:
            note("the interview round is above the total rounds, so both were left empty")
            round_ = total = None

        work_mode = None
        raw_mode = _clean(cells.get("work_mode"))
        if raw_mode:
            work_mode = WORK_MODE_WORDS.get(normalize(raw_mode))
            if work_mode is None:
                note(f"work mode '{raw_mode}' is not remote, hybrid or in person, so it was left empty")

        job_url = _text(cells.get("job_url"))
        if job_url and not job_url.lower().startswith(("http://", "https://")):
            note("the posting link does not start with http:// or https://, so it was left empty")
            job_url = None

        country_id = city_id = None
        location = _text(cells.get("location"))
        country_name, state_name, city_name = _clean(cells.get("country")), _clean(cells.get("state")), _clean(cells.get("city"))
        country = places.country(country_name) if country_name else None
        city = places.city(country, state_name, city_name) if country and city_name else None
        if city is not None:
            country_id, city_id = city.country_id, city.id
            location = place_label(city.name, city.state.name, city.country.name)
        elif country is not None:
            country_id = country.id
            # The export writes "Nowheresville, Canada" (or just "Canada") as the place; the country is stored on its
            # own, so the country is taken back off the text to avoid saying it twice.
            suffix = f", {country.name}"
            if location and normalize(location) == normalize(country.name):
                location = None
            elif location and normalize(location).endswith(normalize(suffix)):
                location = location[: -len(suffix)].rstrip() or None
            if city_name and not location:
                location = city_name
        elif not location:
            # No readable place column, but the parts are there: keep them as typed text.
            location = ", ".join(p for p in (city_name, state_name, country_name) if p) or None

        fields = {
            "company": company,
            "role": role,
            "status": status,
            "date_applied": date_applied,
            "follow_up_date": follow_up,
            "job_url": job_url,
            "location": location,
            "work_mode": work_mode,
            "salary_min": salary_min,
            "salary_max": salary_max,
            "resume_version": _text(cells.get("resume_version")),
            "interview_round": round_,
            "interview_rounds_total": total,
            "notes": _text(cells.get("notes")),
        }
        if date_applied is None and status != ApplicationStatus.SAVED:
            # Same as adding one by hand without a date: today. Said out loud, because it will count as applied today.
            note("no usable applied date, so it was dated today")
        try:
            body = ApplicationCreate.model_validate(fields)
        except ValidationError as error:
            first = error.errors()[0]
            where = ".".join(str(p) for p in first["loc"]) or "a value"
            result.skipped.append(RowNote(number, f"{where}: {str(first['msg']).removeprefix('Value error, ')}"))
            result.adjusted = [n for n in result.adjusted if n.row != number]  # a skipped row is not also "adjusted"
            continue

        application = Application(**{**body.model_dump(), "country_id": country_id, "city_id": city_id}, user_id=user_id)
        history = _history(cells.get("history", ""), body.status) if cells.get("history") else None
        if cells.get("history") and history is None:
            note("the status history could not be read or does not end at the status, so it starts from the status")
        if history:
            previous = None
            for to_status, when in history:
                application.history.append(StatusChange(from_status=previous, to_status=to_status, changed_at=when))
                previous = to_status
        else:
            application.history.append(StatusChange(from_status=None, to_status=application.status))
        db.add(application)
        result.added += 1
        in_file.setdefault(key, number)
        if repeats_existing or repeats_file:
            note(f"{company}, {role} duplicates an application you already have; kept because you chose to keep duplicates")
    return result
