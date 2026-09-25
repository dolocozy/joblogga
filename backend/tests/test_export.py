import csv
import io
from datetime import UTC, date, datetime

import pytest

from app.export import COLUMNS, safe_text


def utc_today() -> str:
    return datetime.now(UTC).date().isoformat()


def add(client, auth, **fields):
    body = {"company": "Acme", "role": "Engineer", **fields}
    res = client.post("/applications", json=body, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def export(client, auth):
    return client.get("/applications/export.csv", headers=auth)


def rows(response) -> list[dict]:
    """Parse the response the way a spreadsheet would (dropping the BOM)."""
    text = response.content.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text, newline="")))


# --- the file itself --------------------------------------------------------


def test_requires_login(client):
    assert client.get("/applications/export.csv").status_code == 401


def test_is_a_downloadable_csv_that_is_not_cached(client, auth):
    res = export(client, auth)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert res.headers["content-disposition"] == f'attachment; filename="joblogga-applications-{date.today().isoformat()}.csv"'
    assert res.headers["cache-control"] == "no-store"


def test_starts_with_a_utf8_byte_order_mark_so_excel_reads_accents(client, auth):
    assert export(client, auth).content.startswith(b"\xef\xbb\xbf")


def test_empty_account_is_just_the_header_row(client, auth):
    text = export(client, auth).content.decode("utf-8-sig")
    assert text == ",".join(COLUMNS) + "\r\n"


def test_route_is_not_mistaken_for_an_application_id(client, auth):
    # "/applications/{id}" would answer 422 for a non-number if it matched first.
    assert export(client, auth).status_code == 200


# --- contents ---------------------------------------------------------------


def test_every_field_is_exported(client, auth):
    add(
        client,
        auth,
        job_url="https://example.com/jobs/1",
        date_applied="2026-03-01",
        resume_version="tech-focused",
        salary_min=90000,
        salary_max=120000,
        location="Remote",
        notes="Referred by Sam",
        status="screening",
        follow_up_date="2026-03-10",
    )
    (row,) = rows(export(client, auth))
    assert row["Company"] == "Acme"
    assert row["Role"] == "Engineer"
    assert row["Status"] == "screening"
    assert row["Date applied"] == "2026-03-01"
    assert row["Follow up by"] == "2026-03-10"
    assert row["Job posting link"] == "https://example.com/jobs/1"
    assert row["Location"] == "Remote"
    assert row["Salary min"] == "90000"
    assert row["Salary max"] == "120000"
    assert row["Resume version"] == "tech-focused"
    assert row["Notes"] == "Referred by Sam"
    # Timestamps in the file are UTC, so compare with today's UTC date (which can differ from the local date).
    assert row["Created at"].startswith(utc_today())
    assert row["Updated at"].startswith(utc_today())


def test_missing_values_are_empty_cells(client, auth):
    add(client, auth)
    (row,) = rows(export(client, auth))
    for column in ("Follow up by", "Job posting link", "Location", "Salary min", "Salary max", "Resume version", "Notes"):
        assert row[column] == "", column


def test_status_history_is_one_readable_cell(client, auth):
    app = add(client, auth, date_applied="2026-03-01")
    client.patch(f"/applications/{app['id']}", json={"status": "interview"}, headers=auth)
    (row,) = rows(export(client, auth))
    today = utc_today()  # history dates are UTC
    assert row["Status history"] == f"applied {today}; interview {today}"


def test_exports_all_applications_newest_first(client, auth):
    add(client, auth, company="Old", date_applied="2026-01-01")
    add(client, auth, company="New", date_applied="2026-03-01")
    add(client, auth, company="Middle", date_applied="2026-02-01")
    assert [r["Company"] for r in rows(export(client, auth))] == ["New", "Middle", "Old"]


def test_is_not_limited_by_the_lists_page_size(client, auth):
    for i in range(55):  # more than the default list page of 50
        add(client, auth, company=f"Company {i}")
    assert len(rows(export(client, auth))) == 55


def test_only_exports_the_logged_in_users_applications(client, auth, other_auth):
    add(client, auth, company="Mine")
    add(client, other_auth, company="Theirs")
    assert [r["Company"] for r in rows(export(client, auth))] == ["Mine"]


# --- awkward text -----------------------------------------------------------


def test_commas_quotes_newlines_and_unicode_survive_a_round_trip(client, auth):
    nasty = 'He said "call Tuesday", then\nsent a note, é 日本語 😀'
    add(client, auth, company='Smith, Jones & "Co"', notes=nasty)
    (row,) = rows(export(client, auth))
    assert row["Company"] == 'Smith, Jones & "Co"'
    assert row["Notes"] == nasty


@pytest.mark.parametrize("dangerous", ["=SUM(1+1)", "+1+1", "-2+3", "@SUM(A1)", '=HYPERLINK("http://evil.example","x")'])
def test_text_that_looks_like_a_formula_is_defused(client, auth, dangerous):
    add(client, auth, company="Acme", notes=dangerous)
    (row,) = rows(export(client, auth))
    assert row["Notes"] == "'" + dangerous  # plain text in a spreadsheet, not a formula


def test_formula_defusing_covers_every_text_column(client, auth):
    add(client, auth, company="=a", role="+b", location="-c", resume_version="@d", notes="=e")
    (row,) = rows(export(client, auth))
    assert [row["Company"], row["Role"], row["Location"], row["Resume version"], row["Notes"]] == ["'=a", "'+b", "'-c", "'@d", "'=e"]


def test_ordinary_text_is_left_alone(client, auth):
    add(client, auth, company="Acme", notes="Called them - went well = good, email@example.com")
    (row,) = rows(export(client, auth))
    assert row["Notes"] == "Called them - went well = good, email@example.com"


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, ""), ("", ""), ("plain", "plain"), ("=x", "'=x"), ("\tx", "'\tx"), ("\rx", "'\rx"), ("a=b", "a=b")],
)
def test_safe_text(value, expected):
    assert safe_text(value) == expected
