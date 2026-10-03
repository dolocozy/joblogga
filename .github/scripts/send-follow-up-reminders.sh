#!/usr/bin/env bash
# Asks the Joblogga API to send today's follow-up digests. Run once a day by
# .github/workflows/follow-up-reminders.yml (Render's free plan has no cron of its own).
#
#   REMINDER_SECRET  (required) the shared secret; the API compares it in constant time
#   API_URL          the API's address, default https://joblogga-api.onrender.com
#   MAX_CALLS        most calls in one run, default 10 (each call handles up to 200 people)
#   CURL_RETRIES, CURL_RETRY_DELAY, CURL_MAX_TIME   how patiently to wait for a sleeping API
#
# Safe to run twice: the API sends each person at most one digest per day.
# Exit status: 0 all done; 1 anything went wrong (so GitHub marks the run failed and emails the owner).
set -euo pipefail

: "${REMINDER_SECRET:?REMINDER_SECRET is not set. Add it as a repository secret, with the same value as REMINDER_SECRET on the API.}"
api_url="${API_URL:-https://joblogga-api.onrender.com}"
api_url="${api_url%/}"
max_calls="${MAX_CALLS:-10}"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT

for call in $(seq 1 "$max_calls"); do
  # The first request wakes a sleeping free-tier API, which takes about a minute: wait, and retry on the errors a
  # waking service gives (502, 503, a refused connection). A reply of 401 is a real answer and is not retried.
  status="$(curl --silent --show-error --output "$body" --write-out '%{http_code}' \
    --max-time "${CURL_MAX_TIME:-300}" --retry "${CURL_RETRIES:-5}" --retry-delay "${CURL_RETRY_DELAY:-30}" \
    --retry-connrefused --retry-all-errors \
    --request POST --header "X-Reminder-Secret: ${REMINDER_SECRET}" \
    "${api_url}/internal/send-follow-up-reminders")" || { echo "Could not reach ${api_url}" >&2; exit 1; }

  if [ "$status" != "200" ]; then
    echo "The API answered ${status}: $(head -c 300 "$body")" >&2
    exit 1
  fi

  summary="$(python3 - "$body" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(d["sent"], d["failed"], d["skipped_unverified"], d["remaining"], d["date"])
PY
)"
  read -r sent failed skipped remaining day <<<"$summary"
  line="call ${call}: ${day} sent=${sent} failed=${failed} skipped_unverified=${skipped} remaining=${remaining}"
  echo "$line"
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "- ${line}" >>"$GITHUB_STEP_SUMMARY"

  if [ "$failed" != "0" ]; then
    echo "${failed} digest(s) could not be sent; the next run will try again." >&2
    exit 1
  fi
  if [ "$remaining" = "0" ]; then
    exit 0
  fi
done

echo "Still ${remaining} digest(s) waiting after ${max_calls} calls." >&2
exit 1
