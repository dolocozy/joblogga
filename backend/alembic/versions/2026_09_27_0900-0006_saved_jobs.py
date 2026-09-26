"""saved jobs: an application may have no applied date

A new status, `saved`, is a job you are interested in but have not applied to. It has no
"applied on" date, so `applications.date_applied` becomes nullable. Existing rows all have
a date and all stay as they are; nothing is rewritten. The status column is a plain string,
so the new value needs no schema change.

Deploy note: the previous release reads `date_applied` as always present, so it would fail
on a Saved row. There are none until someone saves one through this release, so the window
that matters is only a rollback after saving a job. Downgrading deletes Saved jobs (they
cannot be represented without the nullable date) rather than inventing a date for them.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-27 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.alter_column("date_applied", existing_type=sa.Date(), nullable=True)


def downgrade() -> None:
    # Saved jobs have no date to keep the NOT NULL rule with. Their history goes with them (cascade).
    # Explicit, because SQLite migrations run with foreign keys off (see alembic/env.py), so no cascade happens there.
    op.execute("DELETE FROM status_changes WHERE application_id IN (SELECT id FROM applications WHERE date_applied IS NULL)")
    op.execute("DELETE FROM applications WHERE date_applied IS NULL")
    with op.batch_alter_table("applications") as batch:
        batch.alter_column("date_applied", existing_type=sa.Date(), nullable=False)
