# Status list audit (v0.1.1)

Question: is Applied, Screening, Interview, Offer, Rejected, Withdrawn complete and realistic for a real job search?

The pipeline up to Offer is right. The gaps are all at the end of it: what happens **after** an offer, and how to think about "they never wrote back".

## What changed

Two new statuses, both endings that follow Offer:

| Value (API / database) | Label in the UI | Meaning |
| --- | --- | --- |
| `offer_accepted` | Offer accepted | You took the job. |
| `offer_declined` | Offer declined | You turned the offer down. |

Order is now Applied, Screening, Interview, Offer, Offer accepted, Offer declined, Rejected, Withdrawn.

### Why `offer_declined`

Rejected means *the employer* said no; declining an offer means *you* said no. Recording it as Rejected is backwards for a person reading their own logbook, and it also skews the numbers: an offer you turned down is the opposite of a rejection.

### Why `offer_accepted` as well

Without it an accepted offer sits at "Offer" forever, indistinguishable from one still awaiting your answer, and "Offers" on the dashboard cannot say how the search ended. It is the mirror of declining and costs nothing extra to model.

### Existing data

`Rejected` rows whose history contains an `offer -> rejected` transition are rewritten to `offer_declined` (the application's status and that history row). Employers do rescind offers, so this is a heuristic, but a rescinded offer is rare and a declined one is the case this change exists for. Nothing else is remapped. Downgrade maps `offer_declined` back to `rejected` and `offer_accepted` back to `offer`.

Status is stored as a plain string (no database enum type), so adding values needs no schema change; the migration only rewrites rows.

## What did not change, and why

### "Ghosted" / "No response": an insight, not a status

A status is something you record when something happens. Ghosting is the *absence* of an event: nothing changes, and there is no moment at which to click a button. Modelling it as a status would mean remembering to flip applications to "Ghosted" by hand, and it would end the pipeline for an application that may still get a reply on day 40 (which happens). It is derivable, so the dashboard derives it: a line under the summary tiles counts applications still at **Applied** 30 or more days after their date applied, and hides when there are none.

### Others considered and left out

- **Saved / Wishlist (not applied yet):** genuinely useful, but the model requires a date applied and the whole app reads as a record of what you *did*. It would be a different feature, not a fix to the list.
- **Several interview rounds, "Negotiating", "On hold":** these are detail inside a stage. Notes and the dated history already carry them; more columns would make the board wider without making the pipeline clearer.
- **Renaming anything:** the existing six keep their names and values, so no stored data or API client breaks.

## Other places that had to agree

- Kanban board columns, filter dropdown, quick status change, application form: all read the one `STATUSES` list.
- Response rate (#3): Offer accepted and Offer declined count as a response.
- Dashboard tiles: "Offers" now counts every offer stage (Offer, accepted, declined) so a taken or declined offer does not vanish from it. "Still open" now includes Offer, since an offer awaiting your answer is not a closed application.
- Follow-up reminders and the overdue mark: accepted and declined are closed, like Rejected and Withdrawn.
- Stage meter: Offer accepted fills all four ticks; Offer declined shows none, like the other non-progress endings.
- Landing page copy, README.
