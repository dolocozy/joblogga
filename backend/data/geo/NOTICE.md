# Place data

The country, state/province and city tables behind Joblogga's location field come from the
**countries-states-cities-database** by Darshan Gajara and contributors:
https://github.com/dr5hn/countries-states-cities-database

It is licensed under the **Open Database License (ODbL) v1.0**; the full text is in `LICENSE` beside this
file. The rest of this repository is MIT-licensed; these data files are not, and stay under the ODbL.

## What is here

The three files are the upstream files, **unmodified**, pinned to one upstream version so a deploy always
loads exactly the same data:

| File | Source | SHA-256 |
| --- | --- | --- |
| `countries.csv` | `csv/countries.csv` at upstream commit `624a208c3928937d1262ab1646d0b8fc9cacceee` | `20e8e03a30167325db001fcce8b9ca8b80f4862df0ef83a86b37b304e3177e3e` |
| `states.csv` | `csv/states.csv` at the same commit | `367fa287e25497a1089fc69a5d73541bf986d7e474d4da1666f43c49d91c7dc2` |
| `csv-cities.csv.gz` | release asset of upstream release `v3.2-export.7`, whose tag points at that same commit | `3cd409d7215ab6e81a696878d23da5149d76dda4e336e726cc23b8d91765b282` |

Contents: 250 countries, 5,308 states/provinces and 152,970 cities (158,528 rows). A test checks the checksums and
counts, so a changed or truncated file fails the build.

## How it is used

Migration `0008` loads these files into the `countries`, `states` and `cities` tables once, and every lookup
afterwards queries that copy: there is no call to any external service. Only the columns Joblogga needs are read
(id, name, the links between the levels, ISO codes, population). The only thing added is a `search_name` column
on cities: the name lower-cased with accents removed, so a search for "zurich" finds "Zürich".

## Attribution

Place data: countries-states-cities-database (https://github.com/dr5hn/countries-states-cities-database),
ODbL v1.0. Credited in the README and on the landing page.

To update: replace the files with a newer upstream release, update the versions and checksums above and in
`backend/tests/test_geo_data.py`, and add a new migration that reloads the tables (never edit migration 0008).
