"""initial schema

The schema the app created with `create_all` before migrations existed: users,
applications, and the status-change log. This baseline is what an existing
database is recognised as being at (see app/migrations.py), and what a brand-new
database is built from.

Migrations are frozen snapshots: they use plain SQLAlchemy types and never import
application code, so an old migration keeps meaning the same thing however the
models change later.

Revision ID: 0001
Revises:
Create Date: 2026-09-24 14:43:01

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _status() -> sa.Enum:
    # Stored as a plain string, not a Postgres ENUM type, so adding a status later
    # is a code change and not a schema change.
    return sa.Enum(
        "applied",
        "screening",
        "interview",
        "offer",
        "rejected",
        "withdrawn",
        name="applicationstatus",
        native_enum=False,
        length=20,
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "applications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("company", sa.String(length=200), nullable=False),
        sa.Column("role", sa.String(length=200), nullable=False),
        sa.Column("job_url", sa.String(length=2048), nullable=True),
        sa.Column("date_applied", sa.Date(), nullable=False),
        sa.Column("resume_version", sa.String(length=100), nullable=True),
        sa.Column("salary_min", sa.Integer(), nullable=True),
        sa.Column("salary_max", sa.Integer(), nullable=True),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", _status(), nullable=False),
        sa.Column("follow_up_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_applications_user_id", "applications", ["user_id"])
    op.create_index("ix_applications_date_applied", "applications", ["date_applied"])
    op.create_index("ix_applications_follow_up_date", "applications", ["follow_up_date"])
    op.create_index("ix_applications_status", "applications", ["status"])

    op.create_table(
        "status_changes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.Integer(), nullable=False),
        sa.Column("from_status", _status(), nullable=True),
        sa.Column("to_status", _status(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["application_id"], ["applications.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_status_changes_application_id", "status_changes", ["application_id"])


def downgrade() -> None:
    # Dropping a table drops its indexes with it.
    op.drop_table("status_changes")
    op.drop_table("applications")
    op.drop_table("users")
