"""offer outcomes: rows that recorded a declined offer as a rejection

Two statuses were added in code, `offer_accepted` and `offer_declined`. Status is a
plain string column (no database enum type, no CHECK constraint), so nothing about
the schema changes; this migration only corrects existing data.

Before `offer_declined` existed, turning down an offer could only be recorded as
Rejected. An application currently Rejected whose history shows an `offer -> rejected`
transition is taken to be exactly that, and is rewritten (the application and that
history row) to `offer_declined`. This is a judgement: an employer can rescind an
offer, which looks the same in the data, but it is rare, and a declined offer is the
case the new status exists for. Nothing else is touched.

Deploy note: the previous release cannot read `offer_declined`, so between this
migration running and the new release taking over, that release would fail on those
rows (there are none unless someone had that history). Downgrading maps the new
statuses back so an older release keeps working.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-26 11:00:00

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE applications SET status = 'offer_declined'
        WHERE status = 'rejected'
          AND EXISTS (
            SELECT 1 FROM status_changes
            WHERE status_changes.application_id = applications.id
              AND status_changes.from_status = 'offer'
              AND status_changes.to_status = 'rejected'
          )
        """
    )
    op.execute(
        """
        UPDATE status_changes SET to_status = 'offer_declined'
        WHERE from_status = 'offer' AND to_status = 'rejected'
          AND application_id IN (SELECT id FROM applications WHERE status = 'offer_declined')
        """
    )


def downgrade() -> None:
    # Lossy but safe: a release that does not know the new values can read every row again.
    for column in ("status", "to_status", "from_status"):
        table = "applications" if column == "status" else "status_changes"
        op.execute(f"UPDATE {table} SET {column} = 'rejected' WHERE {column} = 'offer_declined'")
        op.execute(f"UPDATE {table} SET {column} = 'offer' WHERE {column} = 'offer_accepted'")
