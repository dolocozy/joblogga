# Changelog

Versions follow [semantic versioning](https://semver.org). Details of the reasoning behind each change are in the README and in `docs/`.

## v0.1.3

### Added

- **Real countries and cities for location.** Location is now a country and a city picked from real data: 250 countries and territories, 5,308 states and provinces and 152,970 cities from the [countries-states-cities database](https://github.com/dr5hn/countries-states-cities-database) (ODbL, credited in the app and the README). It is bundled with the app and loaded once by a migration, so there is no live service, API key or cost. The city list shows each match with its state ("Springfield, Illinois"), and choosing one stores that exact city, so the twenty Springfields in the US stay different places everywhere they are shown, including the CSV. The state and country come with the city, so there is no state box. Typing a place that is missing is still possible, and the form says a typed place has no structure. You can filter by country and state, and keyword search matches cities, states and countries. Existing locations were not touched or parsed: they keep their text, and you can re-pick a place if you want the structure.
- **Duplicate-application warning.** Saving a company and role that match an application you already have (ignoring case and extra spaces, and nothing fuzzier) shows a dismissible warning with a link to the existing one and asks "Add anyway?". It never blocks the save. When editing, it only asks if the company or role was changed.
- **CSV import.** The Account page can import a CSV, and a file exported from Joblogga imports back as it was: fields, picked places and status history. Other spreadsheets work if the first row names the columns (a Company and a Role column are required). It imports what it can and reports the rest: rows that were skipped and why, with their row numbers as a spreadsheet shows them, and values that were left empty (a date like `3/4/2026` is never guessed at, since it could be March or April). Each row goes through the same duplicate check as the warning, and duplicates are summarised in the result rather than raised one by one, so importing the same file twice adds nothing.
- **Archive.** Put away closed applications without deleting them. Archived applications are hidden from the default list and board and from reminders, and reachable with the new "Archived applications" filter; they still count in every dashboard figure and in the CSV export, so archiving never changes your historical response rate or totals. Archive and Unarchive are one click from the detail page, and from a list row once an application is closed. Nothing else (a status change, an edit) unarchives one, and the permanent delete is unchanged.
- **Email reminders for follow-ups.** An opt-in daily email listing your open applications whose follow-up date is today or overdue, **off for everyone, existing accounts included**, switched on from the Account page. It is sent at 13:07 UTC, to verified addresses only, as one digest per person however many things are due, with an unsubscribe link that works without logging in. Each person's day is claimed atomically before sending, so a retry or a double run cannot send twice. Because Render's free plan has no cron, a scheduled GitHub Actions workflow calls a secret-protected API endpoint once a day; the README has the setup.
- **Tags.** Free-form labels for your own prioritising ("referral", "dream job"), up to 10 per application. They are normalised to lower case with spaces collapsed, so "Dream Job" and "dream  job" are one tag (the catch is that tags display in lower case). They show as small quiet labels on the list, board and detail page, are edited as chips on the form with suggestions from tags you have used, and can be filtered (with counts). Keyword search finds them, and they are in the CSV export and import.
- **Time in each pipeline stage.** The dashboard shows the average and median days applications spend in Applied, Screening, Interview and Offer, worked out from the status history, as a chart with a table view. Applications still waiting in a stage are reported separately ("Still here", with how long they have waited so far) instead of being mixed into the average, which would make a stage look quicker or slower than it is. A skipped stage simply has no stay, and the numbers are only as accurate as your updates.

### Fixed

- SQLite foreign keys were left switched off after the migration runner had been through a connection, so `ON DELETE CASCADE` stopped firing on it. This affected local development on SQLite only; production uses Postgres.

### Setting up reminders

Reminders do nothing until `REMINDER_SECRET` is set, with the same value in two places: on Render (service, Environment) and as a GitHub repository secret. Then run the "Follow-up reminders" workflow once by hand from the Actions tab to check it. Until then the endpoint answers 503 and no email is sent. GitHub disables scheduled workflows in a public repository after 60 days with no repository activity; see [the README](README.md#follow-up-reminders).

### Database migrations

Applied automatically on the next start. All are backward compatible with the previous release running during the deploy.

- `0008`: the place tables (loaded once from the bundled data, 158,528 rows in about 15 MB) and nullable `applications.country_id` and `city_id`. No existing location is rewritten. Downgrading drops the new tables and columns and leaves every location's text in place.
- `0009`: nullable `applications.archived_at`. Every existing application stays in the default list.
- `0010`: `users.reminder_emails` (default off, so no existing account starts receiving mail) and `users.reminder_last_sent_on`.
- `0011`: the `application_tags` table, empty at first.

## v0.1.2

### Added

- **Saved jobs.** Track a job you are interested in before you have applied. `saved` is a new first status, so a saved job has the same fields as any application (link, notes, location, work mode, and a follow-up date that doubles as "apply by"). It has no applied date until you apply: **Mark applied** (on the Saved view, the detail page, or by dragging the card on the board) sets today's date, or a date you choose. A job moved back to Saved keeps its old date, so an accidental drag loses nothing. Saved jobs get their own **Saved view** beside List and Board and a Saved column on the board, and are left out of every applied-only figure (total, response rate, weekly chart, no-reply count, status breakdown) until you apply.
- **Interview rounds.** An optional current round and total, shown as "Round 2 of 3" beside the status on the list, board cards and detail page, and editable whenever the status is Interview or an offer. They are a record, not a rule: they keep their last values after the application moves on, and have no effect on status, the response rate or any statistic. Included in the CSV export.

### Decided against

- **Negotiating and On hold were not added.** Negotiating is a phase of Offer that nothing in the app would treat differently. On hold is a real event but not a stage, so if it is ever built it should be a flag on the current status, not a status; nothing would act on it today, so it was left to notes. The reasoning is in [docs/status-audit.md](docs/status-audit.md).

### Changed

- `applications.date_applied` is now optional (only a Saved job lacks one), and the applications list puts saved jobs last on both databases.

### Database migrations

Applied automatically on the next start.

- `0006`: `date_applied` becomes nullable. Existing rows keep their dates. The previous release cannot read a Saved job, so a rollback after saving one needs the downgrade, which deletes Saved jobs (they cannot exist without the nullable date).
- `0007`: nullable `interview_round` and `interview_rounds_total`. Existing rows stay empty. Backward compatible with the previous release.

## v0.1.1

### Added

- **Email verification at signup.** Signing up emails a single-use, 24-hour verification link. After signing up, a screen shows the address the email went to. Unverified people can log in and use everything, with a banner and a "Resend email" button until they verify; completing a password reset also verifies the address. Existing accounts were marked verified.
- **Account deletion.** A new Account page (click your email in the header) permanently deletes the account and everything in it after asking for your password again. Applications, status history and pending tokens are removed by the database's cascade, and the login token stops working immediately. The page also has the CSV export.
- **Offer accepted and Offer declined statuses.** Declining an offer is your decision, not a rejection, so it has its own status, and an accepted offer no longer sits at "Offer" forever. The reasoning, including why "Ghosted" is a dashboard insight and not a status, is in [docs/status-audit.md](docs/status-audit.md).
- **"View posting" link on the applications list and board cards**, opening the posting in a new tab. Left off when an application has no link.
- **Work mode** (Remote, Hybrid or In person, optional) on the application form, shown beside the location on the list, board cards and detail page, filterable, and included in the CSV export.
- **No-reply insight on the dashboard:** how many applications are still at Applied 30 or more days after applying.

### Changed

- **Response rate now reads status history.** An application that reached Screening, Interview, Offer or Rejected counts as answered even if it was later withdrawn (Applied → Interview → Withdrawn used to drop out). Withdrawing before any reply is still left out of both sides.
- **Dashboard tiles:** "Offers" counts every offer stage, and "Still open" includes an offer awaiting your answer.
- **Signup no longer reveals which emails have accounts.** It returns the same reply for every address and does its work after replying, so neither the answer nor its timing differs. It no longer logs you in; you log in after signing up. This closes the known limitation listed in v0.1.0.
- New accounts start at a random session version, so a deleted account's token can never open a later account that reuses its id.

### Database migrations

Applied automatically on the next start. All are backward compatible with the previous release running during the deploy, apart from 0004 (see its note).

- `0003`: `users.email_verified_at` and the verification token table. Existing users are marked verified.
- `0004`: existing Rejected applications whose history shows Offer → Rejected become Offer declined. This is a judgement, since an employer rescinding an offer looks the same in the data; the downgrade maps the new statuses back.
- `0005`: nullable `applications.work_mode`. Existing rows stay unset.

## v0.1.0

First release: accounts with password reset, application tracking with status history, follow-up reminders, search and filters, a dashboard, a Kanban board, CSV export, login rate limiting, database migrations, and deployment on Vercel, Render and Neon.
