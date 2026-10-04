from datetime import date, timedelta

import pytest

from app.resume_stats import MIN_SAMPLE, ResumeStat, resume_breakdown

# --- the calculation, against known fixtures -------------------------------------------------


def rows(version, responded, not_responded, withdrawn_early=0):
    """`responded` applications that heard back, `not_responded` that did not, and `withdrawn_early` withdrawn before any reply
    (counted as applications, but left out of the rate's denominator)."""
    return (
        [(version, True, True)] * responded
        + [(version, False, True)] * not_responded
        + [(version, False, False)] * withdrawn_early
    )


def by_name(result):
    return {s.name: s for s in result}


def test_the_example_from_the_brief_tech_focused_against_events_focused():
    result = by_name(resume_breakdown(rows("Tech-focused", 4, 6) + rows("Events-focused", 3, 17)))
    tech, events = result["Tech-focused"], result["Events-focused"]
    assert (tech.applications, tech.responded, tech.eligible, tech.rate) == (10, 4, 10, 0.4)
    assert (events.applications, events.responded, events.eligible, events.rate) == (20, 3, 20, 0.15)
    assert tech.enough_data and events.enough_data


def test_the_groups_add_up_to_every_application_including_not_specified():
    data = rows("Tech", 2, 4) + rows(None, 1, 5) + rows("", 0, 2) + rows("   ", 1, 0) + rows("Events", 0, 3, withdrawn_early=2)
    result = resume_breakdown(data)
    assert sum(s.applications for s in result) == len(data)
    assert sum(s.responded for s in result) == sum(1 for _, r, _ in data if r)


def test_no_version_blank_and_whitespace_only_are_all_one_not_specified_group():
    result = resume_breakdown(rows(None, 1, 2) + rows("", 1, 1) + rows("  \t ", 0, 1))
    assert len(result) == 1 and result[0].name is None
    assert (result[0].applications, result[0].responded, result[0].eligible) == (6, 2, 6)  # 3 + 2 + 1


def test_a_withdrawal_before_any_reply_is_an_application_but_not_in_the_rate():
    (only,) = resume_breakdown(rows("Tech", 2, 3, withdrawn_early=5))
    assert (only.applications, only.eligible, only.responded, only.rate) == (10, 5, 2, 0.4)  # 2 of 5, not 2 of 10


def test_a_version_with_nothing_eligible_has_no_rate_rather_than_a_zero():
    (only,) = resume_breakdown(rows("Tech", 0, 0, withdrawn_early=3))
    assert (only.applications, only.eligible, only.rate, only.enough_data) == (3, 0, None, False)


@pytest.mark.parametrize("eligible,enough", [(0, False), (1, False), (MIN_SAMPLE - 1, False), (MIN_SAMPLE, True), (MIN_SAMPLE + 1, True), (50, True)])
def test_a_rate_is_only_marked_worth_showing_from_the_minimum_sample(eligible, enough):
    replied = min(1, eligible)
    # (A version with nothing eligible still has applications, all withdrawn early: with no rows at all there would be no group.)
    (only,) = resume_breakdown(rows("Tech", replied, eligible - replied, withdrawn_early=1 if eligible == 0 else 0))
    assert only.enough_data is enough and only.eligible == eligible


def test_the_sample_size_that_matters_is_the_rates_denominator_not_the_total():
    """Ten applications of which six were withdrawn before any reply is a sample of four."""
    (only,) = resume_breakdown(rows("Tech", 2, 2, withdrawn_early=6))
    assert (only.applications, only.eligible, only.enough_data) == (10, 4, False)


def test_one_lucky_application_does_not_look_like_a_100_percent_resume():
    result = by_name(resume_breakdown(rows("One-off", 1, 0) + rows("Workhorse", 4, 16)))
    assert result["One-off"].rate == 1.0 and result["One-off"].enough_data is False  # the rate exists, but the data says "too few"
    assert result["Workhorse"].enough_data is True


def test_the_minimum_sample_is_five():
    assert MIN_SAMPLE == 5


# --- grouping and naming ----------------------------------------------------------------------


def test_versions_are_grouped_ignoring_case_and_extra_spaces():
    data = rows("Tech-focused", 2, 1) + rows("tech-focused", 1, 1) + rows("  TECH-FOCUSED ", 0, 1) + rows("Tech-focused", 1, 0)
    (only,) = resume_breakdown(data)
    assert only.applications == 7 and only.responded == 4


def test_runs_of_spaces_inside_a_name_are_the_same_as_one():
    (only,) = resume_breakdown(rows("Tech  focused", 1, 1) + rows("Tech focused", 1, 1))
    assert only.applications == 4


def test_a_group_is_shown_under_its_most_used_spelling():
    data = rows("tech-focused", 1, 0) + rows("Tech-focused", 2, 2)
    (only,) = resume_breakdown(data)
    assert only.name == "Tech-focused"


def test_a_tie_between_spellings_is_settled_the_same_way_every_time():
    data = rows("tech-focused", 1, 0) + rows("Tech-focused", 1, 0)
    assert {resume_breakdown(data)[0].name, resume_breakdown(list(reversed(data)))[0].name} == {"Tech-focused"}


def test_the_name_shown_has_its_spaces_tidied():
    (only,) = resume_breakdown(rows("  Tech   focused ", 1, 1))
    assert only.name == "Tech focused"


def test_different_words_are_different_versions_nothing_fuzzy():
    result = resume_breakdown(rows("Tech", 1, 1) + rows("Tech v2", 1, 1) + rows("Technical", 1, 1))
    assert len(result) == 3


# --- order ---------------------------------------------------------------------------------------


def test_best_rate_first_among_versions_with_enough_data_then_small_ones_then_not_specified():
    data = (
        rows("Low rate", 1, 9)  # 10%, enough
        + rows("High rate", 6, 4)  # 60%, enough
        + rows("Tiny but lucky", 2, 0)  # 100%, too few
        + rows("Tiny", 0, 3)  # too few as well, but the bigger of the two
        + rows(None, 5, 5)  # 50%, enough: but never ranked against the versions
    )
    # The small groups are not ranked by their (meaningless) rate: the bigger one, which says more, comes first.
    assert [s.name for s in resume_breakdown(data)] == ["High rate", "Low rate", "Tiny", "Tiny but lucky", None]


def test_ties_on_rate_go_to_the_bigger_group_then_alphabetically():
    data = rows("Beta", 2, 8) + rows("Alpha", 1, 4) + rows("Gamma", 4, 16)  # all 20%
    assert [s.name for s in resume_breakdown(data)] == ["Gamma", "Beta", "Alpha"]


def test_nothing_in_nothing_out():
    assert resume_breakdown([]) == []


def test_it_returns_plain_values():
    (only,) = resume_breakdown(rows("Tech", 1, 1))
    assert isinstance(only, ResumeStat) and only.rate == 0.5


# --- through the API ------------------------------------------------------------------------------

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def add(client, auth, version=None, status="applied", applied=None, **fields):
    body = {**BASE, "status": status, "date_applied": (applied or date.today()).isoformat(), **fields}
    if version is not None:
        body["resume_version"] = version
    res = client.post("/applications", json=body, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def resume(client, auth, **params):
    res = client.get("/stats", params=params, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()["resume"]


def versions(client, auth, **params):
    return {v["name"]: v for v in resume(client, auth, **params)["versions"]}


def test_an_account_with_no_applications_has_no_versions_and_still_says_the_minimum(client, auth):
    assert resume(client, auth) == {"min_sample": MIN_SAMPLE, "versions": []}


def test_the_breakdown_is_correct_end_to_end(client, auth):
    for i in range(10):
        add(client, auth, "Tech-focused", status="interview" if i < 4 else "applied")
    for i in range(20):
        add(client, auth, "Events-focused", status="screening" if i < 3 else "applied")
    got = versions(client, auth)
    assert (got["Tech-focused"]["responded"], got["Tech-focused"]["eligible"], got["Tech-focused"]["rate"]) == (4, 10, 0.4)
    assert (got["Events-focused"]["responded"], got["Events-focused"]["eligible"], got["Events-focused"]["rate"]) == (3, 20, 0.15)


def test_an_application_with_no_version_goes_into_not_specified(client, auth):
    add(client, auth, None)
    add(client, auth, "")
    add(client, auth, "Tech", status="interview")
    got = versions(client, auth)
    assert got[None]["applications"] == 2 and got["Tech"]["applications"] == 1


def test_interview_then_withdrawn_still_counts_as_a_response_for_its_version(client, auth):
    app_id = add(client, auth, "Tech", status="applied")
    client.patch(f"/applications/{app_id}", json={"status": "interview"}, headers=auth)
    client.patch(f"/applications/{app_id}", json={"status": "withdrawn"}, headers=auth)
    tech = versions(client, auth)["Tech"]
    assert (tech["applications"], tech["responded"], tech["eligible"]) == (1, 1, 1)  # answered, whatever happened next


def test_withdrawn_before_any_reply_is_left_out_of_the_denominator_but_still_an_application(client, auth):
    add(client, auth, "Tech", status="withdrawn")
    add(client, auth, "Tech", status="applied")
    tech = versions(client, auth)["Tech"]
    assert (tech["applications"], tech["responded"], tech["eligible"], tech["rate"]) == (2, 0, 1, 0.0)


def test_the_overall_response_rate_and_the_breakdown_agree(client, auth):
    for version, status in [("A", "interview"), ("A", "applied"), ("B", "rejected"), (None, "applied"), (None, "withdrawn"), ("B", "offer")]:
        add(client, auth, version, status=status)
    body = client.get("/stats", headers=auth).json()
    assert sum(v["responded"] for v in body["resume"]["versions"]) == body["response"]["responded"]
    assert sum(v["eligible"] for v in body["resume"]["versions"]) == body["response"]["eligible"]
    assert sum(v["applications"] for v in body["resume"]["versions"]) == body["total"]


def test_case_and_spacing_do_not_split_a_version(client, auth):
    add(client, auth, "Tech-focused", status="interview")
    add(client, auth, "tech-focused ", status="applied")
    got = versions(client, auth)
    assert list(got) == ["Tech-focused"] and got["Tech-focused"]["applications"] == 2


def test_enough_data_flips_at_the_minimum_sample(client, auth):
    for _ in range(MIN_SAMPLE - 1):
        add(client, auth, "Tech")
    assert versions(client, auth)["Tech"]["enough_data"] is False
    add(client, auth, "Tech")
    assert versions(client, auth)["Tech"]["enough_data"] is True


def test_the_time_window_scopes_the_breakdown_like_every_other_figure(client, auth):
    today = date.today()
    add(client, auth, "Old", applied=today - timedelta(weeks=20), status="interview")
    add(client, auth, "Recent", applied=today)
    assert set(versions(client, auth)) == {"Old", "Recent"}
    assert set(versions(client, auth, weeks=4)) == {"Recent"}


def test_saved_jobs_are_not_in_it(client, auth):
    add(client, auth, "Tech", status="saved")
    assert resume(client, auth)["versions"] == []


def test_archived_applications_still_count(client, auth):
    app_id = add(client, auth, "Tech", status="rejected")
    before = resume(client, auth)
    client.patch(f"/applications/{app_id}", json={"archived": True}, headers=auth)
    assert resume(client, auth) == before  # archiving is a view preference, not a deletion


def test_only_your_own_applications(client, auth, other_auth):
    add(client, other_auth, "Theirs", status="interview")
    add(client, auth, "Mine")
    assert set(versions(client, auth)) == {"Mine"}


def test_it_comes_back_in_reading_order(client, auth):
    for _ in range(5):
        add(client, auth, "Low")
    for _ in range(5):
        add(client, auth, "High", status="interview")
    add(client, auth, "Tiny", status="interview")
    add(client, auth, None)
    assert [v["name"] for v in resume(client, auth)["versions"]] == ["High", "Low", "Tiny", None]
