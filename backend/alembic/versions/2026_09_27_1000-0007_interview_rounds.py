"""interview rounds: an optional current round and total on an application

Two nullable integer columns. Existing rows get NULL (nothing recorded). Backward
compatible with the code running during the deploy: nullable, no default, so the previous
version's INSERTs and SELECTs are unaffected.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-27 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.add_column(sa.Column("interview_round", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("interview_rounds_total", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.drop_column("interview_rounds_total")
        batch.drop_column("interview_round")
