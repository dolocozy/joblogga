"""follow-up reminder emails: an opt-in flag and the day the last digest went out

`users.reminder_emails` is NOT NULL with a server default of false, so every existing account is OFF: reminders
are opt-in, and nobody starts receiving mail because of this deploy. `users.reminder_last_sent_on` is nullable.

Backward compatible with the code running during the deploy: the new columns are nullable or have a default, so
the previous version's INSERTs and SELECTs into `users` are unaffected.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-03 11:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("reminder_emails", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("reminder_last_sent_on", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("reminder_last_sent_on")
        batch.drop_column("reminder_emails")
