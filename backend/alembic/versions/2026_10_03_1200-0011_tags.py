"""tags: free-form labels on applications

One row per (application, tag). The tag is stored normalised (lower case, single spaces; see app/tags.py). The
composite primary key makes a repeat impossible and serves "does this application have this tag", which is what the
filter asks. Rows go with their application (ON DELETE CASCADE).

Backward compatible with the code running during the deploy: a new table the previous version never touches.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-03 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "application_tags",
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("tag", sa.String(length=30), nullable=False),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("application_id", "tag"),
    )


def downgrade() -> None:
    op.drop_table("application_tags")
