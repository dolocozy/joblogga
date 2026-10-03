"""archive: a nullable archived-at time on applications

A nullable timestamp (rather than a boolean) records when an application was archived. NULL means
not archived, so every existing application stays exactly where it is, in the default list.

Backward compatible with the code running during the deploy: nullable with no default, so the previous
version's INSERTs and SELECTs are unaffected (it will simply show archived applications, which is the
safe direction to fail in).

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-03 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.add_column(sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.drop_column("archived_at")
