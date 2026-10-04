"""contacts: the people you have dealt with at a company, per application

One row per contact; an application can have several. Rows go with their application (ON DELETE CASCADE).
Backward compatible with the code running during the deploy: a new table the previous version never touches.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-04 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "application_contacts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("linkedin_url", sa.String(length=2048), nullable=True),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_application_contacts_application_id", "application_contacts", ["application_id"])


def downgrade() -> None:
    op.drop_table("application_contacts")
