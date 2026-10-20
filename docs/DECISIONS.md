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
