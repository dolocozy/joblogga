"""Tags: free-form labels for your own prioritising ("referral", "dream job"), separate from status.

Free-form rather than a fixed list, but normalised on save so they cannot fragment: "Dream Job", "dream  job" and
" dream job " are one tag, stored as "dream job". That is the whole price of free-form (tags show in lower case).
Normalising happens in exactly one place, here, for typing, the API, import and filtering.
"""

import re
import unicodedata

MAX_TAG_LENGTH = 30
MAX_TAGS = 10

# A comma or semicolon would break the places tags are written as one cell (the CSV) and the box where a comma
# means "that's one tag, start the next". Control characters are never part of a label.
_FORBIDDEN = re.compile(r"[,;\x00-\x1f\x7f]")
_SPLIT = re.compile(r"[,;]")


def normalize_tag(raw: str) -> str:
    """Lower case, accents composed (so "é" typed two ways is one tag), runs of whitespace collapsed to one space."""
    return " ".join(unicodedata.normalize("NFC", raw).lower().split())


def validate_tag(tag: str) -> None:
    """Raises ValueError saying what is wrong with an already-normalised, non-empty tag."""
    if len(tag) > MAX_TAG_LENGTH:
        raise ValueError(f"A tag can be at most {MAX_TAG_LENGTH} characters ('{tag[:12]}...' is {len(tag)})")
    if _FORBIDDEN.search(tag):
        raise ValueError("A tag cannot contain commas or semicolons")


def normalize_tags(raw: list[str]) -> list[str]:
    """The tags to store: normalised, empties and repeats dropped, sorted. Raises ValueError for a bad one or too many."""
    tags: set[str] = set()
    for item in raw:
        tag = normalize_tag(item)
        if not tag:
            continue
        validate_tag(tag)
        tags.add(tag)
    if len(tags) > MAX_TAGS:
        raise ValueError(f"An application can have at most {MAX_TAGS} tags")
    return sorted(tags)


def parse_tag_cell(cell: str) -> tuple[list[str], list[str]]:
    """Tags from one spreadsheet cell, split on ';' or ','. Returns (tags to keep, problems), never raising: an
    import keeps what it can. A bad tag, or any past the limit, is dropped and described."""
    kept: list[str] = []
    problems: list[str] = []
    for piece in _SPLIT.split(cell):
        tag = normalize_tag(piece)
        if not tag or tag in kept:
            continue
        try:
            validate_tag(tag)
        except ValueError:
            problems.append(f"the tag '{tag[:20]}' is longer than {MAX_TAG_LENGTH} characters, so it was left out")
            continue
        if len(kept) == MAX_TAGS:
            problems.append(f"only {MAX_TAGS} tags are kept, so '{tag}' and any after it were left out")
            break
        kept.append(tag)
    return sorted(kept), problems
