"""weekly goal: an optional number of applications to send each week

`users.weekly_goal` is nullable and NULL means no goal: nobody has one until they set it, so nothing is shown to anyone who has not
opted in. Backward compatible with the code running during the deploy: nullable with no default.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-04 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("weekly_goal", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("weekly_goal")
