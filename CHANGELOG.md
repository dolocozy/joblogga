# Changelog

Versions follow [semantic versioning](https://semver.org). Details of the reasoning behind each change are in the README and in `docs/`.

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
