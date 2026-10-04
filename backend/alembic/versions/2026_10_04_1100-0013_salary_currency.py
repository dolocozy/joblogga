"""salary currency: which currency salary_min and salary_max are in

`applications.salary_currency` is NOT NULL with a server default of 'USD', so every existing application gets USD in the
same statement that adds the column: nothing is left NULL, and nothing is left silently ambiguous.

Why USD is a sound default for existing rows: until now the salary fields had no currency at all, the app was built and used
by one person in the US, and the picked-place data only arrived in the last release, so the existing figures are USD by
construction. A row with no salary has a currency that is simply never shown. Nothing is inferred from a row's place (that
would be a guess presented as data); anyone with a salary in another currency can change it on the application.

Backward compatible with the code running during the deploy: the server default means the previous version's INSERTs, which
do not mention the column, still work, and its SELECTs ignore it.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-04 11:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.add_column(sa.Column("salary_currency", sa.String(length=3), nullable=False, server_default="USD"))


def downgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.drop_column("salary_currency")
