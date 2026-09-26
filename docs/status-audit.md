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

---

# v0.1.2: Saved

The v0.1.1 audit left "Saved / Wishlist" out because the model requires a date applied and the app reads as a record of what you *did*. This extends that decision rather than reversing it: the requirement is what changed.

## Decision: a status, not a separate list

A saved job is an application that has not been made yet, and it moves through the same lifecycle: it gets a company, role, link, notes and a follow-up date, and one day you click "I applied". A parallel "saved jobs" entity would duplicate all of that and need its own conversion code to copy fields across. So `saved` is the first status, before Applied, and it passes the audit's own test: there is a discrete moment when you click something (saving it, and later applying).

## The date problem

`date_applied` was required, so it became optional (migration 0006). The alternative, a placeholder date such as the day it was saved, would have been a lie that every date-based figure would then have counted. Rules:

- A saved job has no applied date. Leaving Saved fills it in with today, or a date you choose.
- A job moved *back* to Saved (say, an accidental drag) keeps its old date, so nothing is lost, and moving it forward again keeps that date rather than replacing it with today.
- An application that has been made cannot have its date cleared.
- Saved jobs sort after dated ones on both databases (`NULLS LAST` is explicit, because Postgres and SQLite otherwise disagree).

## Kept out of the numbers

Everything on the dashboard means "applications you have submitted", so the stats query excludes Saved by status (not just by the missing date): total, response rate, weekly chart, the no-reply count, and the status breakdown, which does not list Saved at all. A job moved back to Saved leaves the figures even though its history shows an interview, and returns when applied again.

## Where they show up

- **Saved view** (`?view=saved`) next to List and Board: the jobs you have not applied to, with a one-click "Mark applied". The List is the jobs you have applied to. It has no date filters, since there is nothing to filter on.
- **Board:** a Saved column on the left; dragging a card to Applied applies it (today's date).
- **Detail page:** an "Applied to this one?" panel with the date preset to today.
- **Follow-up date** doubles as "apply by" for a saved job, so it appears in the reminders and goes overdue like any other.
- The stage meter shows no progress for Saved, and Saved is not a closed status.

---

# v0.1.2: Negotiating and On hold (not added)

The v0.1.1 audit called both "detail inside a stage". They were revisited now that Saved and interview rounds have been added, and neither was added. The test used throughout: a status should be something you would click a button for, and it should change what the app does or shows. A pipeline stage earns a column; a detail belongs in notes, history or a small field.

## Negotiating: not added, as a status or as a flag

It is a phase of Offer, not a step after it. There is a moment you could point to ("I countered"), but nothing else in the app would treat it differently:

- The dashboard already counts every offer stage together, and Offer means "awaiting your answer" whether or not you are haggling over it.
- It is not a response (it follows one), not a closed state, and it changes no reminder or figure.
- As a status it would add a tenth board column that carries no more information than Offer. As a flag it would be a switch that nothing reads.

Notes and the dated history already say "countered on Friday", which is where that detail belongs.

## On hold: not added, though it is the closer call

Unlike Negotiating, On hold is a real event and is not a stage. A hiring freeze can hit an application at Screening, Interview or Offer, and it later resumes at the same stage. That is why it does not work as a status: it would pull the card out of its stage column, you would have to remember where it came from, and the history would read Interview → On hold → Interview, which the response-rate logic and stage meter would then have to look through.

The right shape, if it were built, is a flag layered on the current status: a boolean that leaves the card in its column with a small mark, filterable and one click to toggle. It was not built because nothing in the app would act on it. It would change no figure and no reminder, so it would be a label for the owner's memory that the notes field already provides. If it later proves worth having, the flag (not a status) is the design, and it is roughly the size of the interview rounds change.

## Status list after v0.1.2

Saved, Applied, Screening, Interview, Offer, Offer accepted, Offer declined, Rejected, Withdrawn. Interview rounds are a field, not statuses. Ghosted, Negotiating and On hold are deliberately not statuses.
