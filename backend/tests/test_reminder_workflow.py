"""The GitHub Actions side of the reminders: the schedule, and the script it runs, against a fake API."""

import json
import os
import re
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
import yaml  # comes with uvicorn[standard]

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / ".github" / "scripts" / "send-follow-up-reminders.sh"
WORKFLOW = REPO / ".github" / "workflows" / "follow-up-reminders.yml"
SECRET = "super-secret-value-" + "x" * 30

pytestmark = pytest.mark.skipif(not SCRIPT.exists(), reason="the .github folder is not part of this checkout")


# --- the workflow file --------------------------------------------------------------


@pytest.fixture(scope="module")
def workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def test_it_runs_daily_at_1307_utc(workflow):
    triggers = workflow[True]  # YAML reads the key `on` as the boolean True
    assert [s["cron"] for s in triggers["schedule"]] == ["7 13 * * *"]
    assert "workflow_dispatch" in triggers  # and can be run by hand to test it


def test_the_schedule_is_off_the_hour(workflow):
    minute = int(workflow[True]["schedule"][0]["cron"].split()[0])
    assert minute not in (0, 30)  # GitHub delays and drops the busiest moments


def test_the_secret_comes_from_repository_secrets_and_is_not_written_in_the_file(workflow):
    step = workflow["jobs"]["send"]["steps"][-1]
    assert step["env"]["REMINDER_SECRET"] == "${{ secrets.REMINDER_SECRET }}"
    assert step["run"] == ".github/scripts/send-follow-up-reminders.sh"
    text = WORKFLOW.read_text()
    assert not re.search(r"REMINDER_SECRET\s*[:=]\s*[\"']?[A-Za-z0-9]{16,}", text)


def test_it_asks_for_no_more_permission_than_reading_the_repository(workflow):
    assert workflow["permissions"] == {"contents": "read"}


def test_it_never_runs_in_a_fork_and_cannot_overlap_itself(workflow):
    assert workflow["jobs"]["send"]["if"] == "github.repository == 'dolocozy/joblogga'"
    assert workflow["concurrency"] == {"group": "follow-up-reminders", "cancel-in-progress": False}
    assert workflow["jobs"]["send"]["timeout-minutes"] <= 30  # a stuck run must not sit there for hours


def test_the_script_is_executable_and_never_echoes_commands(workflow):
    assert os.access(SCRIPT, os.X_OK)  # the workflow runs it directly
    text = SCRIPT.read_text()
    assert "set -x" not in text and "xtrace" not in text  # that would print the secret into the log
    assert text.startswith("#!/usr/bin/env bash") and "set -euo pipefail" in text


# --- the script, against a fake API ----------------------------------------------------


class FakeApi:
    """Answers each POST with the next (status, body) from `replies`, and records what it was sent."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.requests: list[dict] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                outer.requests.append({"path": self.path, "secret": self.headers.get("X-Reminder-Secret")})
                status, body = outer.replies.pop(0) if len(outer.replies) > 1 else outer.replies[0]
                payload = json.dumps(body).encode() if not isinstance(body, bytes) else body
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):  # keep the test output quiet
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def digest(sent=0, failed=0, skipped=0, remaining=0):
    return (200, {"date": "2026-06-10", "sent": sent, "failed": failed, "skipped_unverified": skipped, "remaining": remaining})


@pytest.fixture
def fake_api():
    made = []

    def make(*replies):
        api = FakeApi(replies)
        made.append(api)
        return api

    yield make
    for api in made:
        api.close()


def run_script(api_url, secret=SECRET, **extra_env):
    env = {**os.environ, "API_URL": api_url, "CURL_RETRY_DELAY": "0", "CURL_RETRIES": "2", "CURL_MAX_TIME": "10", **extra_env}
    env.pop("REMINDER_SECRET", None)
    if secret is not None:
        env["REMINDER_SECRET"] = secret
    return subprocess.run([str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60)


def everything(result) -> str:
    return result.stdout + result.stderr


def test_a_normal_run_posts_to_the_endpoint_with_the_secret_and_exits_cleanly(fake_api):
    api = fake_api(digest(sent=3, skipped=1))
    result = run_script(api.url)
    assert result.returncode == 0, everything(result)
    assert api.requests == [{"path": "/internal/send-follow-up-reminders", "secret": SECRET}]
    assert "sent=3" in result.stdout and "skipped_unverified=1" in result.stdout


def test_nothing_due_is_a_success(fake_api):
    assert run_script(fake_api(digest()).url).returncode == 0


def test_it_keeps_calling_while_people_remain_and_stops_when_none_do(fake_api):
    api = fake_api(digest(sent=200, remaining=350), digest(sent=200, remaining=150), digest(sent=150, remaining=0))
    result = run_script(api.url)
    assert result.returncode == 0, everything(result)
    assert len(api.requests) == 3
    assert result.stdout.count("remaining=") == 3


def test_it_gives_up_with_a_failure_rather_than_looping_forever(fake_api):
    api = fake_api(digest(sent=200, remaining=1000))
    result = run_script(api.url, MAX_CALLS="3")
    assert result.returncode == 1
    assert len(api.requests) == 3
    assert "waiting after 3 calls" in result.stderr


def test_a_digest_that_could_not_be_sent_fails_the_run_so_github_emails_the_owner(fake_api):
    result = run_script(fake_api(digest(sent=2, failed=1)).url)
    assert result.returncode == 1
    assert "could not be sent" in result.stderr


def test_a_wrong_secret_fails_at_once_without_retrying(fake_api):
    api = fake_api((401, {"detail": "Invalid secret"}))
    result = run_script(api.url)
    assert result.returncode == 1
    assert len(api.requests) == 1  # a real answer is not retried
    assert "answered 401" in result.stderr and "Invalid secret" in result.stderr


@pytest.mark.parametrize("status,detail", [(503, "Reminders are not configured"), (429, "Too many attempts. Try again in 15 minutes.")])
def test_other_refusals_fail_with_the_reason(fake_api, status, detail):
    result = run_script(fake_api((status, {"detail": detail})).url)
    assert result.returncode == 1
    assert detail in result.stderr


def test_a_waking_server_is_retried_until_it_answers(fake_api):
    api = fake_api((503, b"<html>Service Unavailable</html>"), (502, b"Bad gateway"), digest(sent=1))
    result = run_script(api.url, CURL_RETRIES="5")
    assert result.returncode == 0, everything(result)
    assert len(api.requests) == 3  # two failures while it woke up, then the real answer


def test_a_server_that_never_wakes_fails_the_run(fake_api):
    api = fake_api((503, b"<html>Service Unavailable</html>"))
    result = run_script(api.url, CURL_RETRIES="2")
    assert result.returncode == 1
    assert "answered 503" in result.stderr


def test_an_address_nothing_listens_on_fails_the_run():
    result = run_script("http://127.0.0.1:9", CURL_RETRIES="1")  # the discard port: refused
    assert result.returncode == 1
    assert "Could not reach" in result.stderr


def test_a_missing_secret_stops_it_with_instructions_before_any_request(fake_api):
    api = fake_api(digest())
    result = run_script(api.url, secret=None)
    assert result.returncode != 0
    assert "REMINDER_SECRET is not set" in result.stderr
    assert api.requests == []


def test_an_empty_secret_counts_as_missing(fake_api):
    api = fake_api(digest())
    result = run_script(api.url, secret="")
    assert result.returncode != 0 and api.requests == []


@pytest.mark.parametrize(
    "replies",
    [[digest(sent=1)], [(401, {"detail": "Invalid secret"})], [digest(failed=1)], [(503, {"detail": "nope"})]],
)
def test_the_secret_never_appears_in_the_output_whatever_happens(fake_api, replies):
    result = run_script(fake_api(*replies).url)
    assert SECRET not in everything(result)


def test_a_trailing_slash_on_the_address_is_fine(fake_api):
    api = fake_api(digest())
    assert run_script(api.url + "/").returncode == 0
    assert api.requests[0]["path"] == "/internal/send-follow-up-reminders"  # not //internal


def test_it_writes_a_summary_line_for_the_github_run_page(fake_api, tmp_path):
    summary = tmp_path / "summary.md"
    result = run_script(fake_api(digest(sent=4)).url, GITHUB_STEP_SUMMARY=str(summary))
    assert result.returncode == 0
    assert "sent=4" in summary.read_text()


def test_the_default_address_is_the_production_api():
    assert "https://joblogga-api.onrender.com" in SCRIPT.read_text()


def test_the_reply_it_expects_is_the_one_the_endpoint_gives():
    """The script reads these four fields; this fails if the endpoint stops providing one of them."""
    from app.schemas import ReminderRunOut

    assert {"sent", "failed", "skipped_unverified", "remaining", "date"} <= set(ReminderRunOut.model_fields)
