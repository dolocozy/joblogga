import csv
import io

import pytest

from app.export import COLUMNS

def csv_bytes(rows, header=None, delimiter=",", bom=False, encoding="utf-8") -> bytes:
    out = io.StringIO()
    writer = csv.writer(out, delimiter=delimiter, lineterminator="\r\n")
    if header is not None:
        writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    text = ("﻿" if bom else "") + out.getvalue()
    return text.encode(encoding)


def do_import(client, auth, data: bytes, **params):
    return client.post("/applications/import", content=data, params=params, headers={**auth, "Content-Type": "text/csv"})


def ok(client, auth, data, **params):
    res = do_import(client, auth, data, **params)
    assert res.status_code == 200, res.text
    return res.json()


def listing(client, auth):
    return client.get("/applications", params={"limit": 200}, headers=auth).json()["items"]


def reasons(notes):
    return [(n["row"], n["reason"]) for n in notes]


def adjustments(result):
    """The adjustments, leaving out "dated today": most of these tiny files have no date column, which is a note of its own."""
    return [n for n in result["adjusted"] if "dated today" not in n["reason"]]


MINIMAL = ["Company", "Role"]


# --- a clean file ----------------------------------------------------------------


def test_a_clean_file_imports_every_row_with_all_its_fields(client, auth):
    data = csv_bytes(
        [["Acme", "Engineer", "Interview", "2026-03-01", "2026-04-01", "https://jobs.example.com/1", "Remote", "", "", "", "remote", "90000", "120000", "tech", "2", "3", "Referred by Sam"]],
        header=["Company", "Role", "Status", "Date applied", "Follow up by", "Job posting link", "Location", "Country", "State", "City", "Work mode", "Salary min", "Salary max", "Resume version", "Interview round", "Interview rounds total", "Notes"],
    )
    result = ok(client, auth, data)
    assert result == {"total_rows": 1, "blank_rows": 0, "added": 1, "skipped": [], "duplicates": [], "adjusted": []}
    (app,) = listing(client, auth)
    assert (app["company"], app["role"], app["status"], app["date_applied"], app["follow_up_date"]) == ("Acme", "Engineer", "interview", "2026-03-01", "2026-04-01")
    assert (app["job_url"], app["location"], app["work_mode"], app["salary_min"], app["salary_max"]) == ("https://jobs.example.com/1", "Remote", "remote", 90000, 120000)
    assert (app["resume_version"], app["interview_round"], app["interview_rounds_total"], app["notes"]) == ("tech", 2, 3, "Referred by Sam")


def test_each_imported_application_starts_a_status_history(client, auth):
    ok(client, auth, csv_bytes([["Acme", "Engineer", "screening", "2026-03-01"]], header=["Company", "Role", "Status", "Date applied"]))
    (app,) = listing(client, auth)
    detail = client.get(f"/applications/{app['id']}", headers=auth).json()
    assert [(h["from_status"], h["to_status"]) for h in detail["history"]] == [(None, "screening")]


def test_only_company_and_role_are_needed(client, auth):
    result = ok(client, auth, csv_bytes([["Acme", "Engineer"]], header=MINIMAL))
    assert result["added"] == 1
    (app,) = listing(client, auth)
    assert (app["status"], app["location"], app["job_url"], app["salary_min"], app["work_mode"]) == ("applied", None, None, None, None)


# --- a messy file ----------------------------------------------------------------


def test_a_row_missing_its_company_or_role_is_skipped_and_reported_without_stopping_the_rest(client, auth):
    data = csv_bytes([["Acme", "Engineer", ""], ["", "Analyst", ""], ["Globex", "", ""], ["", "", "only a note"], ["Initech", "Manager", ""]], header=MINIMAL + ["Notes"])
    result = ok(client, auth, data)
    assert result["added"] == 2
    assert reasons(result["skipped"]) == [(3, "missing company name"), (4, "missing role"), (5, "missing company and role")]
    assert sorted(a["company"] for a in listing(client, auth)) == ["Acme", "Initech"]


def test_row_numbers_are_the_ones_a_spreadsheet_shows(client, auth):
    data = csv_bytes([["A", "x"], ["B", "x"], ["", "x"]], header=MINIMAL)  # header is row 1, so the bad row is row 4
    assert reasons(ok(client, auth, data)["skipped"]) == [(4, "missing company name")]


def test_blank_rows_are_ignored_not_reported_as_problems(client, auth):
    data = csv_bytes([["Acme", "Engineer"], ["", ""], [" ", "  "], ["Globex", "Analyst"]], header=MINIMAL)
    result = ok(client, auth, data)
    assert (result["added"], result["blank_rows"], result["skipped"], result["total_rows"]) == (2, 2, [], 4)


def test_extra_and_unknown_columns_are_ignored(client, auth):
    data = csv_bytes([["Acme", "x1", "Engineer", "ignored", "2026-03-01"]], header=["Company", "Mystery", "Role", "Favourite colour", "Date applied"])
    result = ok(client, auth, data)
    assert result["added"] == 1 and result["adjusted"] == []
    assert listing(client, auth)[0]["date_applied"] == "2026-03-01"


def test_rows_shorter_than_the_header_are_fine(client, auth):
    data = b"Company,Role,Status,Notes\r\nAcme,Engineer\r\nGlobex,Analyst,offer\r\n"
    result = ok(client, auth, data)
    assert result["added"] == 2
    assert {a["company"]: a["status"] for a in listing(client, auth)} == {"Acme": "applied", "Globex": "offer"}


def test_column_names_are_matched_loosely_and_other_spreadsheets_headers_work(client, auth):
    data = csv_bytes([["Acme", "Engineer", "Applied", "2026-03-01", "https://x.example.com", "$90,000", "$120,000"]], header=["  EMPLOYER ", "Job Title", "status", "Applied", "URL", "Min Salary", "Max Salary"])
    ok(client, auth, data)
    (app,) = listing(client, auth)
    assert (app["company"], app["role"], app["date_applied"], app["job_url"], app["salary_min"], app["salary_max"]) == ("Acme", "Engineer", "2026-03-01", "https://x.example.com", 90000, 120000)


def test_status_is_read_by_value_or_by_the_words_shown(client, auth):
    rows = [[f"Co{i}", "x", s] for i, s in enumerate(["Offer accepted", "offer_declined", "WITHDRAWN", "in progress", "Saved"])]
    result = ok(client, auth, csv_bytes(rows, header=["Company", "Role", "Status"]))
    assert {a["company"]: a["status"] for a in listing(client, auth)} == {"Co0": "offer_accepted", "Co1": "offer_declined", "Co2": "withdrawn", "Co3": "applied", "Co4": "saved"}
    assert reasons(adjustments(result)) == [(5, "status 'in progress' is not one of the statuses, so it was set to Applied")]


def test_a_saved_job_needs_no_applied_date(client, auth):
    result = ok(client, auth, csv_bytes([["Wish Co", "Engineer", "saved"]], header=["Company", "Role", "Status"]))
    assert result["adjusted"] == []
    assert listing(client, auth)[0]["date_applied"] is None


def test_a_missing_applied_date_is_dated_today_and_said_so(client, auth):
    from datetime import date

    result = ok(client, auth, csv_bytes([["Acme", "Engineer", "applied", ""]], header=["Company", "Role", "Status", "Date applied"]))
    assert reasons(result["adjusted"]) == [(2, "no usable applied date, so it was dated today")]
    assert listing(client, auth)[0]["date_applied"] == date.today().isoformat()


@pytest.mark.parametrize("raw", ["3/4/2026", "next week", "2026-13-45", "March 4"])
def test_a_date_that_cannot_be_read_is_left_empty_not_guessed(client, auth, raw):
    result = ok(client, auth, csv_bytes([["Acme", "Engineer", "applied", "2026-03-01", raw]], header=["Company", "Role", "Status", "Date applied", "Follow up by"]))
    assert reasons(result["adjusted"]) == [(2, f"follow-up date '{raw}' could not be read (use YYYY-MM-DD), so it was left empty")]
    assert listing(client, auth)[0]["follow_up_date"] is None


@pytest.mark.parametrize("raw,expected", [("2026-03-01", "2026-03-01"), ("2026/3/1", "2026-03-01"), ("2026-03-01T09:30:00Z", "2026-03-01"), ("2026-03-01 09:30", "2026-03-01")])
def test_the_date_formats_that_are_read(client, auth, raw, expected):
    ok(client, auth, csv_bytes([["Acme", "Engineer", raw]], header=["Company", "Role", "Date applied"]))
    assert listing(client, auth)[0]["date_applied"] == expected


def test_bad_optional_values_are_dropped_and_reported_but_the_row_is_kept(client, auth):
    data = csv_bytes(
        [["Acme", "Engineer", "ftp://files.example.com", "lots", "9", "maybe", "7", "3"]],
        header=["Company", "Role", "Job posting link", "Salary min", "Salary max", "Work mode", "Interview round", "Interview rounds total"],
    )
    result = ok(client, auth, data)
    assert result["added"] == 1
    assert sorted(n["reason"] for n in adjustments(result)) == sorted(
        [
            "the posting link does not start with http:// or https://, so it was left empty",
            "salary min 'lots' is not a whole number, so it was left empty",
            "work mode 'maybe' is not remote, hybrid or in person, so it was left empty",
            "the interview round is above the total rounds, so both were left empty",
        ]
    )
    (app,) = listing(client, auth)
    assert (app["job_url"], app["salary_min"], app["salary_max"], app["work_mode"], app["interview_round"], app["interview_rounds_total"]) == (None, None, 9, None, None, None)


def test_a_minimum_salary_above_the_maximum_clears_both(client, auth):
    result = ok(client, auth, csv_bytes([["Acme", "Engineer", "200", "100"]], header=["Company", "Role", "Salary min", "Salary max"]))
    assert reasons(adjustments(result)) == [(2, "the minimum salary is above the maximum, so both were left empty")]
    assert (listing(client, auth)[0]["salary_min"], listing(client, auth)[0]["salary_max"]) == (None, None)


def test_work_mode_spellings(client, auth):
    rows = [[f"Co{i}", "x", w] for i, w in enumerate(["Remote", "HYBRID", "In person", "in-person", "on-site", "onsite"])]
    ok(client, auth, csv_bytes(rows, header=["Company", "Role", "Work mode"]))
    assert [a["work_mode"] for a in sorted(listing(client, auth), key=lambda a: a["company"])] == ["remote", "hybrid", "in_person", "in_person", "in_person", "in_person"]


def test_a_value_the_database_would_refuse_skips_the_row_with_the_reason(client, auth):
    data = csv_bytes([["Acme", "Engineer"], ["x" * 201, "Analyst"], ["Globex", "y" * 201]], header=MINIMAL)
    result = ok(client, auth, data)
    assert result["added"] == 1
    assert [n["row"] for n in result["skipped"]] == [3, 4]
    assert all("at most 200" in n["reason"] or "200" in n["reason"] for n in result["skipped"])


def test_semicolon_and_tab_separated_files_work_as_excel_saves_them(client, auth):
    for delimiter in (";", "\t"):
        # a different company each pass, so the second import is not a duplicate of the first
        data = csv_bytes([[f"Co{ord(delimiter)}", "Engineer", "2026-03-01"]], header=["Company", "Role", "Date applied"], delimiter=delimiter)
        assert ok(client, auth, data)["added"] == 1


def test_a_comma_inside_a_quoted_note_and_a_newline_survive(client, auth):
    ok(client, auth, csv_bytes([["Acme", "Engineer", "Line one, with comma\nLine two"]], header=["Company", "Role", "Notes"]))
    assert listing(client, auth)[0]["notes"] == "Line one, with comma\nLine two"


def test_accents_survive_as_utf8_with_or_without_the_marker_and_as_windows_1252(client, auth):
    for i, (bom, encoding) in enumerate([(False, "utf-8"), (True, "utf-8"), (False, "cp1252")]):
        ok(client, auth, csv_bytes([[f"Société Générale {i}", "Ingénieur"]], header=MINIMAL, bom=bom, encoding=encoding))
    assert sorted(a["company"] for a in listing(client, auth)) == ["Société Générale 0", "Société Générale 1", "Société Générale 2"]


def test_the_leading_apostrophe_the_export_adds_to_formula_looking_text_is_taken_off(client, auth):
    ok(client, auth, csv_bytes([["'=SUM(A1)", "'+1 role", "'-dash"]], header=["Company", "Role", "Notes"]))
    (app,) = listing(client, auth)
    assert (app["company"], app["role"], app["notes"]) == ("=SUM(A1)", "+1 role", "-dash")


def test_an_ordinary_leading_apostrophe_is_left_alone(client, auth):
    ok(client, auth, csv_bytes([["'Nsync Records", "Engineer"]], header=MINIMAL))
    assert listing(client, auth)[0]["company"] == "'Nsync Records"


# --- files that cannot be imported ----------------------------------------------


@pytest.mark.parametrize(
    "data,message",
    [
        (b"", "The file is empty."),
        (b"Company,Notes\r\nAcme,hi\r\n", "needs a Role column"),
        (b"Role,Notes\r\nEngineer,hi\r\n", "needs a Company column"),
        (b"Foo,Bar\r\n1,2\r\n", "needs a Company and Role column"),
    ],
)
def test_an_unusable_file_is_refused_with_a_message_and_adds_nothing(client, auth, data, message):
    res = do_import(client, auth, data)
    assert res.status_code == 422
    assert message in res.json()["detail"]
    assert listing(client, auth) == []


def test_a_header_only_file_imports_nothing_without_complaint(client, auth):
    assert ok(client, auth, csv_bytes([], header=MINIMAL)) == {"total_rows": 0, "blank_rows": 0, "added": 0, "skipped": [], "duplicates": [], "adjusted": []}


def test_a_file_over_the_row_limit_is_refused_whole(client, auth):
    res = do_import(client, auth, csv_bytes([[f"Co{i}", "x"] for i in range(1001)], header=MINIMAL))
    assert res.status_code == 422 and "at most 1000" in res.json()["detail"]
    assert listing(client, auth) == []


def test_exactly_the_row_limit_is_fine(client, auth):
    assert ok(client, auth, csv_bytes([[f"Co{i}", "x"] for i in range(1000)], header=MINIMAL))["added"] == 1000


def test_a_file_over_the_size_limit_is_refused(client, auth):
    res = do_import(client, auth, b"Company,Role\r\n" + b"a,b\r\n" * 500_000)
    assert res.status_code == 422 and "too big" in res.json()["detail"]


def test_it_needs_a_login(client):
    assert client.post("/applications/import", content=b"Company,Role\r\nA,B\r\n", headers={"Content-Type": "text/csv"}).status_code == 401


def test_a_body_that_is_not_csv_text_is_refused_not_a_server_error(client, auth):
    res = client.post("/applications/import", content=b"\x00\x01\x02\xff\xfe", headers={**auth, "Content-Type": "text/csv"})
    assert res.status_code == 422


# --- duplicates -------------------------------------------------------------------


def test_re_importing_a_file_adds_nothing_the_second_time(client, auth):
    data = csv_bytes([["Acme", "Engineer"], ["Globex", "Analyst"]], header=MINIMAL)
    assert ok(client, auth, data)["added"] == 2
    again = ok(client, auth, data)
    assert again["added"] == 0
    assert reasons(again["duplicates"]) == [(2, "Acme, Engineer is already in your applications"), (3, "Globex, Analyst is already in your applications")]
    assert len(listing(client, auth)) == 2


def test_duplicates_match_ignoring_case_and_spacing_like_the_warning(client, auth):
    client.post("/applications", json={"company": "Acme Corp", "role": "Backend Engineer"}, headers=auth)
    result = ok(client, auth, csv_bytes([["  ACME  corp ", "backend engineer"]], header=MINIMAL))
    assert result["added"] == 0 and len(result["duplicates"]) == 1


def test_a_different_role_at_the_same_company_is_not_a_duplicate(client, auth):
    client.post("/applications", json={"company": "Acme", "role": "Engineer"}, headers=auth)
    assert ok(client, auth, csv_bytes([["Acme", "Senior Engineer"]], header=MINIMAL))["added"] == 1


def test_a_repeat_inside_the_same_file_is_caught_and_points_at_the_first(client, auth):
    result = ok(client, auth, csv_bytes([["Acme", "Engineer"], ["Globex", "Analyst"], ["acme", "ENGINEER"]], header=MINIMAL))
    assert result["added"] == 2
    assert reasons(result["duplicates"]) == [(4, "acme, ENGINEER repeats row 2 of this file")]


def test_keeping_duplicates_adds_them_and_says_so(client, auth):
    client.post("/applications", json={"company": "Acme", "role": "Engineer"}, headers=auth)
    result = ok(client, auth, csv_bytes([["Acme", "Engineer"], ["Acme", "Engineer"]], header=MINIMAL), skip_duplicates="false")
    assert result["added"] == 2 and result["duplicates"] == []
    assert len(adjustments(result)) == 2 and all("kept because you chose to keep duplicates" in n["reason"] for n in adjustments(result))
    assert len(listing(client, auth)) == 3


def test_duplicates_are_only_checked_against_your_own_applications(client, auth, other_auth):
    client.post("/applications", json={"company": "Acme", "role": "Engineer"}, headers=other_auth)
    assert ok(client, auth, csv_bytes([["Acme", "Engineer"]], header=MINIMAL))["added"] == 1


def test_a_row_that_is_both_incomplete_and_skipped_is_not_also_listed_as_adjusted(client, auth):
    result = ok(client, auth, csv_bytes([["x" * 201, "Eng", "nonsense status"]], header=["Company", "Role", "Status"]))
    assert len(result["skipped"]) == 1 and result["adjusted"] == []


# --- isolation and atomicity ------------------------------------------------------


def test_imported_rows_belong_to_the_importer_only(client, auth, other_auth):
    ok(client, auth, csv_bytes([["Acme", "Engineer"]], header=MINIMAL))
    assert len(listing(client, auth)) == 1
    assert listing(client, other_auth) == []


def test_imported_applications_appear_in_the_stats(client, auth):
    ok(client, auth, csv_bytes([["Acme", "Engineer", "interview", "2026-03-01"], ["Globex", "Analyst", "applied", "2026-03-02"]], header=["Company", "Role", "Status", "Date applied"]))
    assert client.get("/stats", headers=auth).json()["total"] == 2


# --- the round trip ---------------------------------------------------------------


def export_text(client, auth) -> bytes:
    return client.get("/applications/export.csv", headers=auth).content


def test_the_export_header_is_fully_understood_by_the_import(client, auth):
    """Every column the export writes is either read by the import or knowingly ignored: none is forgotten."""
    from app.duplicates import normalize
    from app.importer import HEADERS as KNOWN, IGNORED_HEADERS

    assert all(normalize(c) in KNOWN or normalize(c) in IGNORED_HEADERS for c in COLUMNS)
    assert IGNORED_HEADERS == {"created at", "updated at"}


def test_exporting_then_importing_into_a_fresh_account_reproduces_everything(client, auth, geo):
    from tests.conftest import make_user

    base = {"company": "A", "role": "R"}
    created = [
        {**base, "company": "Springfield Co", "city_id": geo["Springfield", "Illinois"], "status": "interview", "date_applied": "2026-03-01", "interview_round": 2, "interview_rounds_total": 3, "work_mode": "hybrid", "salary_min": 90000, "salary_max": 120000, "resume_version": "tech", "notes": "multi\nline, with comma", "follow_up_date": "2026-05-01", "job_url": "https://jobs.example.com/a"},
        {**base, "company": "Other Springfield", "city_id": geo["Springfield", "Ohio"], "date_applied": "2026-03-02"},
        {**base, "company": "Country Only", "country_id": geo["Canada"], "date_applied": "2026-03-03"},
        {**base, "company": "Typed In Canada", "country_id": geo["Canada"], "location": "Nowheresville", "date_applied": "2026-03-04"},
        {**base, "company": "Typed Only", "location": "Somewhere remote", "date_applied": "2026-03-05"},
        {**base, "company": "Wish Co", "status": "saved"},
        {**base, "company": "=Formula Co", "role": "+Role", "notes": "@mention", "date_applied": "2026-03-06"},
    ]
    for body in created:
        assert client.post("/applications", json=body, headers=auth).status_code == 201
    moved = client.get("/applications", params={"limit": 200}, headers=auth).json()["items"]
    interview = next(a for a in moved if a["company"] == "Springfield Co")
    client.patch(f"/applications/{interview['id']}", json={"status": "offer"}, headers=auth)  # a history with two steps

    exported = export_text(client, auth)
    fresh = make_user(client, email="fresh@example.com")
    result = ok(client, fresh, exported)
    assert (result["added"], result["skipped"], result["duplicates"]) == (len(created), [], [])

    def summary(headers):
        rows = client.get("/applications", params={"limit": 200}, headers=headers).json()["items"]
        keep = ("company", "role", "status", "date_applied", "follow_up_date", "job_url", "location", "location_display", "work_mode", "salary_min", "salary_max", "resume_version", "interview_round", "interview_rounds_total", "notes")
        out = {}
        for a in rows:
            detail = client.get(f"/applications/{a['id']}", headers=headers).json()
            out[a["company"]] = {
                **{k: a[k] for k in keep},
                "country": a["country"] and a["country"]["name"],
                "city": a["city"] and (a["city"]["name"], a["city"]["state"]["name"]),
                "history": [(h["from_status"], h["to_status"]) for h in detail["history"]],
            }
        return out

    original, restored = summary(auth), summary(fresh)
    assert restored == original  # every field, the picked places, the typed ones, and the status history
    assert restored["Springfield Co"]["city"] == ("Springfield", "Illinois")  # the right Springfield
    assert restored["Other Springfield"]["city"] == ("Springfield", "Ohio")
    assert restored["Typed In Canada"]["location"] == "Nowheresville" and restored["Typed In Canada"]["country"] == "Canada"
    assert restored["Springfield Co"]["history"] == [(None, "interview"), ("interview", "offer")]


def test_importing_your_own_export_back_is_all_duplicates(client, auth):
    client.post("/applications", json={"company": "Acme", "role": "Engineer"}, headers=auth)
    again = ok(client, auth, export_text(client, auth))
    assert (again["added"], len(again["duplicates"])) == (0, 1)


def test_a_history_that_does_not_match_the_status_is_ignored_with_a_note(client, auth):
    data = csv_bytes([["Acme", "Engineer", "offer", "applied 2026-03-01; interview 2026-03-08"]], header=["Company", "Role", "Status", "Status history"])
    result = ok(client, auth, data)
    assert [n["reason"] for n in result["adjusted"] if "history" in n["reason"]]
    (app,) = listing(client, auth)
    detail = client.get(f"/applications/{app['id']}", headers=auth).json()
    assert [(h["from_status"], h["to_status"]) for h in detail["history"]] == [(None, "offer")]


# --- places -----------------------------------------------------------------------


def test_a_country_state_and_city_that_name_a_real_place_become_that_exact_place(client, auth, geo):
    data = csv_bytes([["Acme", "Eng", "", "United States", "Missouri", "Springfield"]], header=["Company", "Role", "Location", "Country", "State", "City"])
    ok(client, auth, data)
    (app,) = listing(client, auth)
    assert app["city"]["id"] == geo["Springfield", "Missouri"]
    assert app["location_display"] == "Springfield, Missouri, United States"


def test_a_city_name_that_is_ambiguous_without_a_state_stays_typed_text(client, auth, geo):
    ok(client, auth, csv_bytes([["Acme", "Eng", "United States", "Springfield"]], header=["Company", "Role", "Country", "City"]))
    (app,) = listing(client, auth)
    assert app["city"] is None
    assert (app["country"]["name"], app["location"]) == ("United States", "Springfield")


def test_a_city_found_without_a_state_when_it_is_unambiguous(client, auth, geo):
    ok(client, auth, csv_bytes([["Acme", "Eng", "Canada", "Toronto"]], header=["Company", "Role", "Country", "City"]))
    assert listing(client, auth)[0]["city"]["id"] == geo["Toronto", "Ontario"]


def test_the_country_can_be_named_by_its_code(client, auth, geo):
    ok(client, auth, csv_bytes([["Acme", "Eng", "CA", "Toronto"], ["Globex", "Eng", "CHE", ""]], header=["Company", "Role", "Country", "City"]))
    by_company = {a["company"]: a for a in listing(client, auth)}
    assert by_company["Acme"]["city"]["name"] == "Toronto" and by_company["Globex"]["country"]["name"] == "Switzerland"


def test_a_place_the_dataset_does_not_know_is_kept_as_typed_text(client, auth, geo):
    ok(client, auth, csv_bytes([["Acme", "Eng", "Narnia", "Cair Paravel"], ["Globex", "Eng", "Narnia", ""]], header=["Company", "Role", "Country", "City"]))
    by_company = {a["company"]: a for a in listing(client, auth)}
    assert (by_company["Acme"]["location"], by_company["Acme"]["country"], by_company["Acme"]["city"]) == ("Cair Paravel, Narnia", None, None)
    assert by_company["Globex"]["location"] == "Narnia"


def test_a_wrong_state_for_a_real_city_does_not_pick_some_other_city(client, auth, geo):
    ok(client, auth, csv_bytes([["Acme", "Eng", "United States", "Texas", "Springfield"]], header=["Company", "Role", "Country", "State", "City"]))
    (app,) = listing(client, auth)
    assert app["city"] is None and app["country"]["name"] == "United States"
