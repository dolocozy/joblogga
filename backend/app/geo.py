"""Place data: a helper for searching it, and the one function that must agree with the loader.

The tables (countries, states, cities) are loaded once by migration 0008 from the files in
data/geo (see the NOTICE there). Everything at request time reads that copy in our own database.
"""

import unicodedata

# Letters that Unicode decomposition does not turn into a plain letter plus an accent.
_SPECIAL = str.maketrans({"ß": "ss", "ø": "o", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i", "ħ": "h"})


def search_key(text: str) -> str:
    """Lower-case with accents removed: "Zürich" and "zurich" and "ZURICH" all give "zurich".

    Cities are stored with this key (cities.search_name) and searches are turned into it too, so a
    plain index on the key answers "starts with what was typed". Migration 0008 carries its own copy of this
    function (migrations never import app code); a test checks that the two agree on every stored name.
    """
    decomposed = unicodedata.normalize("NFKD", text.strip().lower().translate(_SPECIAL))
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def next_key(key: str) -> str:
    """The smallest string greater than every string that starts with `key`, for a range search.

    `search_name >= key AND search_name < next_key(key)` is "starts with key", and it works with a plain
    index on both Postgres and SQLite (a LIKE 'key%' only uses one under special collations).
    """
    return key[:-1] + chr(ord(key[-1]) + 1)


def place_label(city: str, state: str | None, country: str) -> str:
    """"Springfield, Illinois, United States": what a picked city is called everywhere it is shown."""
    return ", ".join(part for part in (city, state, country) if part)
