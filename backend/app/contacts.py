"""Contacts: the people you have dealt with at a company for one application (recruiter, hiring manager, referral).

In the CSV a contact is one line, "Name | Title | email | linkedin", and an application's contacts are one cell with a
line each. That keeps every field (the export doubles as a backup, and the import promises a round trip), and is why
the four fields may not contain a pipe or a line break.
"""

import re

MAX_CONTACTS = 10
SEPARATOR = " | "

# The separators of the CSV format, and control characters (never part of a name).
_FORBIDDEN = re.compile(r"[|\x00-\x1f\x7f]")


def check_text(value: str | None) -> str | None:
    """Raises ValueError if `value` contains a pipe or a control character (so it could not be written to the CSV)."""
    if value is not None and _FORBIDDEN.search(value):
        raise ValueError("cannot contain a pipe (|) or a line break")
    return value


def contact_line(name: str, title: str | None, email: str | None, linkedin_url: str | None) -> str:
    """One contact as a line of the CSV cell. Empty fields are kept in place so the columns stay positional, and
    trailing empty ones are dropped."""
    fields = [name, title or "", email or "", linkedin_url or ""]
    while len(fields) > 1 and not fields[-1]:
        fields.pop()
    return SEPARATOR.join(fields)


def parse_contacts_cell(cell: str) -> list[tuple[str, str, str, str]]:
    """The lines of a Contacts cell as (name, title, email, linkedin) with "" for what is missing. Blank lines are skipped.
    Reading is forgiving about the spaces around the separators ("a|b" works), since people edit these by hand."""
    parsed = []
    for line in cell.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split("|")]
        parts += [""] * (4 - len(parts))
        parsed.append((parts[0], parts[1], parts[2], "|".join(parts[3:]).strip()))  # extra pipes can only belong to the last field
    return parsed
