# Decisions

Short log of design and build decisions: date, decision, why.

## 2026-10-20 Redesign around lines (v0.2.0)
- **Direction:** every application is a route with four stops, instead of a ledger with a stage meter. Chosen because many job trackers look alike (sidebar, cards, kanban), and the route shows where each application is stuck at a glance.
- **White page:** the page is plain `#FFFFFF`. The separate sheet tint is gone; panels are white with a thin rule.
- **Palette:** cobalt `#2347D6` (actions, links, first line), tangerine `#F26B1D`, signal `#00805A`, plum `#8A2D6B`, brick `#C4380F` (trouble only), ink `#101820`. Night mode has its own values. All text pairs pass 4.5:1 and graphics 3:1 in both themes (tested in `theme.test.tsx`).
- **Marker removed:** the yellow highlight is gone. Overdue follow-ups are brick text with the word "overdue", and notes use a tangerine tint.
- **Type:** Fraunces replaces Newsreader for titles; Hanken Grotesk and IBM Plex Mono stay.
- **Tokens renamed:** `paper` to `platform`, `sheet` to `ticket`, `pine` to `cobalt`. The `.sheet` class keeps its name. Old names would be misleading.
- **Nav labels unchanged:** Applications, Dashboard and FAQ keep their names for now; renaming them to Lines and Numbers is left for the phases that rebuild those pages.
- **Square stops:** the radius rules (2px and 4px, nothing round) still hold, so stops are squares.
- **Phases:** 1 tokens, fonts and header; 2 Lines view; 3 detail and forms; 4 dashboard, offers and board; 5 landing and auth; 6 screenshots and release.

## 2026-10-20 Lines view on the applications list (phase 2)
- **Route per row:** the status column became a four-stop route (solid line to where it is, dashed beyond, larger stop for now). The status dropdown stays under it, so changing status is still one click and works with a keyboard.
- **Closed applications keep their stop:** a rejected or withdrawn application shows the stop it reached, on a grey line, with an empty larger square (brick for rejected). That needed the API to say how far it got, so applications now carry `furthest_stage` (0 to 4), worked out from the status history and loaded in one extra query for the list.
- **Line color by id:** cobalt, tangerine, signal or plum, picked from the application id so it never changes. The color is decoration; the status word and the stop names carry the meaning.
- **Saved view and landing sample unchanged for now:** saved jobs have no route yet, and the landing sample moves in phase 5.

## 2026-10-20 Detail page and forms (phase 3)
- **Detail page:** the route sits under the title with the four stop names above it, and the status history is a vertical route (newest stop on top, larger), each entry a stop on a line in the application's color. The small stage meter beside the status word is gone there, since the route says the same thing.
- **Forms:** the add and edit form is three stops on a vertical line: The job, Where it stands, Labels and notes. Field order within them changed (status, dates and resume now sit together) but labels, validation and inline errors are untouched.
- **Shared pieces:** `lineFor(id)` and `STOP_AT` live in `routeStops.ts`, `isEnded` in `status.ts`, `StopNames` beside `Route`.

## 2026-10-20 Landing and sign-in pages (phase 5)
- **Hero:** three made-up routes under the intro text draw in from the left as the page loads (a clip reveal, so the stops are never stretched; nothing moves for people who ask for reduced motion). They are decorative and hidden from screen readers.
- **Sample page:** the landing's sample list uses the same route column as the real list, including a rejected row that stops at Screening.
- **How it works:** the four stages are stops on a line (the line is hidden on phones, where they stack two across).
- **Headline unchanged:** "A logbook for your job search" stays, since the logbook is still what the app is; the routes are how it looks inside.
- **Sign-in, sign-up and reset pages:** already one centered white panel with the new wordmark, so no change beyond the tokens.
