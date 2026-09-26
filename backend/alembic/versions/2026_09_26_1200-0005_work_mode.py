"""work mode: remote / hybrid / in-person on an application

A nullable string column (the same plain-string storage the status uses, so no database
enum type and no CHECK constraint). Existing rows get NULL, meaning "not specified":
nothing is guessed for applications entered before the field existed.

Backward compatible with the code running during the deploy: the column is nullable with
no default, so the previous version's INSERTs and SELECTs are unaffected.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-26 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.add_column(
            sa.Column(
                "work_mode",
                sa.Enum("remote", "hybrid", "in_person", name="workmode", native_enum=False, length=20),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.drop_column("work_mode")
