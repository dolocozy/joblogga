"""Response rate by resume version: which resume gets answered.

Uses exactly the response-rate definition of the dashboard: an application COUNTS as having responded if it ever reached a
response status (per its history, so Applied -> Interview -> Withdrawn still counts), and the rate's denominator leaves out
applications withdrawn before any reply (your decision, not the employer's).

Three judgement calls, each visible in the output rather than buried:

- Grouping. `resume_version` is free text, so "Tech-focused", "tech-focused" and "tech-focused " would split into three bars
  and spoil the comparison. Versions are grouped ignoring case and extra spaces (the same rule as the duplicate warning), and shown
  under the spelling used most.
- No version set is an explicit "Not specified" group (name None), not a silent omission, so the groups always add up to every
  application the other dashboard figures cover.
- A small group's rate is noise: one application that got a reply is "100%". So the raw counts are always there, and the rate is
  marked `enough_data` only from MIN_SAMPLE applications that count toward it. At 5, one more reply moves a rate by 20 points; below
  that a percentage says more than the data can.
"""

from collections import Counter
from dataclasses import dataclass

from app.duplicates import normalize

MIN_SAMPLE = 5


@dataclass
class ResumeStat:
    name: str | None  # None is "not specified"
    applications: int  # everything with this version, including those withdrawn before any reply
    responded: int
    eligible: int  # the rate's denominator
    rate: float | None  # responded / eligible; None when nothing is eligible. Compute-only: see enough_data
    enough_data: bool  # eligible >= MIN_SAMPLE: only then is the rate worth showing


def resume_breakdown(rows: list[tuple[str | None, bool, bool]]) -> list[ResumeStat]:
    """`rows` holds (resume version as typed, ever responded, counts toward the rate) per application.

    Ordered for reading: versions with enough data first, best rate first, then the small ones by size, with "Not specified" last
    because it is not a version to compare against."""
    groups: dict[str, list[tuple[str, bool, bool]]] = {}
    for raw, responded, eligible in rows:
        spelled = " ".join(raw.split()) if raw and raw.strip() else ""
        groups.setdefault(normalize(spelled), []).append((spelled, responded, eligible))

    stats: list[ResumeStat] = []
    for key, members in groups.items():
        responded = sum(1 for _, r, _ in members if r)
        eligible = sum(1 for _, _, e in members if e)
        name = None
        if key:
            spellings = Counter(s for s, _, _ in members)
            # The most used spelling; ties go to the alphabetically first, so the label does not change between loads.
            name = min(spellings, key=lambda s: (-spellings[s], s.casefold(), s))
        stats.append(
            ResumeStat(
                name=name,
                applications=len(members),
                responded=responded,
                eligible=eligible,
                rate=responded / eligible if eligible else None,
                enough_data=eligible >= MIN_SAMPLE,
            )
        )

    def order(s: ResumeStat):
        return (
            s.name is None,  # "not specified" last
            not s.enough_data,  # enough data before too little
            -(s.rate or 0) if s.enough_data else 0,  # best rate first among those with enough
            -s.applications,  # then the bigger groups
            (s.name or "").casefold(),
        )

    return sorted(stats, key=order)
