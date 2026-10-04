"""The one search box: words found across company, role, notes, tags and location, layered on top of every other filter."""

import pytest

BASE = {"company": "Placeholder", "role": "Engineer"}


def add(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def found(client, auth, **params):
    res = client.get("/applications", params=params, headers=auth)
    assert res.status_code == 200, res.text
    return [a["company"] for a in res.json()["items"]]


@pytest.fixture
def jobs(client, auth):
    add(client, auth, company="Acme Corp", role="Backend Engineer", date_applied="2026-01-10", location="Remote", tags=["dream job"], notes="Met Dana at the meetup")
    add(client, auth, company="Globex", role="Data Analyst", date_applied="2026-02-10", status="interview", notes="Great team, strong mentoring", tags=["backup"])
    add(client, auth, company="Initech", role="Backend Developer", date_applied="2026-03-10", status="rejected", tags=["dream job"])
    add(client, auth, company="Umbrella", role="Designer", date_applied="2026-04-10", location="Berlin, Germany")


# --- each field, any case ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "query,expected",
    [
        ("acme", ["Acme Corp"]),  # company
        ("ACME", ["Acme Corp"]),
        ("analyst", ["Globex"]),  # role
        ("ANALYST", ["Globex"]),
        ("mentoring", ["Globex"]),  # notes
        ("MeetUp", ["Acme Corp"]),
        ("backup", ["Globex"]),  # a tag
        ("BACKUP", ["Globex"]),
        ("berlin", ["Umbrella"]),  # location
        ("GERMANY", ["Umbrella"]),
    ],
)
def test_each_field_is_searched_whatever_the_case(client, auth, jobs, query, expected):
    assert found(client, auth, q=query) == expected


def test_a_word_can_be_part_of_a_longer_one(client, auth, jobs):
    assert found(client, auth, q="mentor") == ["Globex"]
    assert found(client, auth, q="ckend") == ["Initech", "Acme Corp"]


def test_a_tag_is_found_by_its_whole_name_or_a_piece_of_it(client, auth, jobs):
    assert found(client, auth, q="dream job") == ["Initech", "Acme Corp"]
    assert found(client, auth, q="dream") == ["Initech", "Acme Corp"]


# --- several words ------------------------------------------------------------------------------------


def test_every_word_must_match_but_each_may_be_in_a_different_field(client, auth, jobs):
    assert found(client, auth, q="acme backend") == ["Acme Corp"]  # company + role
    assert found(client, auth, q="backend dream") == ["Initech", "Acme Corp"]  # role + tag
    assert found(client, auth, q="backend meetup") == ["Acme Corp"]  # role + notes
    assert found(client, auth, q="remote acme") == ["Acme Corp"]  # location + company


def test_the_order_of_the_words_does_not_matter(client, auth, jobs):
    assert found(client, auth, q="backend acme") == found(client, auth, q="acme backend") == ["Acme Corp"]


def test_one_word_that_matches_nothing_rules_the_application_out(client, auth, jobs):
    assert found(client, auth, q="acme designer") == []
    assert found(client, auth, q="backend zzzz") == []


def test_extra_spaces_and_tabs_between_words_are_ignored(client, auth, jobs):
    assert found(client, auth, q="  acme \t  backend  ") == ["Acme Corp"]


def test_a_query_of_only_spaces_is_no_search_at_all(client, auth, jobs):
    assert found(client, auth, q="   ") == found(client, auth) == ["Umbrella", "Initech", "Globex", "Acme Corp"]


def test_one_word_found_in_two_fields_of_the_same_application_lists_it_once(client, auth):
    add(client, auth, company="Zeta", role="Zeta Lead", notes="zeta zeta", tags=["zeta"])
    res = client.get("/applications", params={"q": "zeta"}, headers=auth).json()
    assert [a["company"] for a in res["items"]] == ["Zeta"] and res["total"] == 1


# --- layered on the other filters --------------------------------------------------------------------


def test_it_narrows_the_status_filter_rather_than_replacing_it(client, auth, jobs):
    assert found(client, auth, q="backend") == ["Initech", "Acme Corp"]
    assert found(client, auth, q="backend", status="rejected") == ["Initech"]
    assert found(client, auth, q="backend", status="interview") == []  # no backend job is at interview


def test_it_combines_with_dates_tags_and_the_company_filter(client, auth, jobs):
    assert found(client, auth, q="backend", date_from="2026-02-01") == ["Initech"]
    assert found(client, auth, q="backend", tag="dream job", date_to="2026-02-01") == ["Acme Corp"]
    assert found(client, auth, q="engineer", company="acme") == ["Acme Corp"]


def test_it_respects_the_archive_filter(client, auth, jobs):
    initech = next(a for a in client.get("/applications", headers=auth).json()["items"] if a["company"] == "Initech")
    client.patch(f"/applications/{initech['id']}", json={"archived": True}, headers=auth)
    assert found(client, auth, q="backend") == ["Acme Corp"]  # archived are hidden by default, search or not
    assert found(client, auth, q="backend", archived="include") == ["Initech", "Acme Corp"]
    assert found(client, auth, q="backend", archived="only") == ["Initech"]


def test_the_total_and_paging_follow_the_search(client, auth, jobs):
    page = client.get("/applications", params={"q": "backend", "limit": 1, "offset": 1}, headers=auth).json()
    assert page["total"] == 2 and [a["company"] for a in page["items"]] == ["Acme Corp"]


# --- nothing found, odd input, other people ----------------------------------------------------------


def test_no_match_is_an_empty_list_not_an_error(client, auth, jobs):
    res = client.get("/applications", params={"q": "nothing like this"}, headers=auth)
    assert res.status_code == 200
    assert res.json() == {"items": [], "total": 0}


def test_a_search_on_an_empty_account_is_also_just_empty(client, auth):
    assert found(client, auth, q="anything") == []


@pytest.mark.parametrize("odd", ["%", "_", "100%", "a_b", "'; DROP TABLE applications; --", "\\", "ünïcode", "日本語"])
def test_odd_characters_are_searched_for_literally_and_never_break_it(client, auth, jobs, odd):
    assert client.get("/applications", params={"q": odd}, headers=auth).status_code == 200
    assert found(client, auth, q=odd) == []


def test_percent_and_underscore_are_not_wildcards(client, auth):
    add(client, auth, company="Fifty percent", notes="50% remote", role="Analyst")
    add(client, auth, company="Fifty other", notes="500 remote", role="Analyst")
    assert found(client, auth, q="50%") == ["Fifty percent"]
    add(client, auth, company="Snake", notes="a_b", role="Analyst")
    add(client, auth, company="Plain", notes="axb", role="Analyst")
    assert found(client, auth, q="a_b") == ["Snake"]


def test_the_query_length_limit_is_enforced_with_a_clear_error(client, auth):
    assert client.get("/applications", params={"q": "x" * 201}, headers=auth).status_code == 422


def test_a_long_list_of_words_still_works_and_all_of_them_count(client, auth, jobs):
    many = " ".join(["a"] * 60)  # as many words as the 200-character limit allows (every application here has an "a")
    assert found(client, auth, q=many) == ["Umbrella", "Initech", "Globex", "Acme Corp"]
    assert found(client, auth, q=many + " acme") == ["Acme Corp"]


def test_it_only_searches_your_own_applications(client, auth, other_auth):
    add(client, other_auth, company="Theirs", role="Backend Engineer", notes="secret", tags=["secret"])
    add(client, auth, company="Mine", role="Backend Engineer")
    assert found(client, auth, q="backend") == ["Mine"]
    assert found(client, auth, q="secret") == []
    assert found(client, auth, q="theirs") == []


def test_it_needs_a_login(client):
    assert client.get("/applications", params={"q": "x"}).status_code == 401
