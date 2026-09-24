from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from app import models  # noqa: F401  (importing registers every table on Base.metadata)
from app.config import settings
from app.db import Base

config = context.config

# Alembic's own log setup would silence the app's loggers when migrations run at
# startup inside the API process, so only apply it for the command-line tool.
if config.config_file_name is not None and config.attributes.get("connection") is None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# What "the schema should look like": the models. `alembic revision --autogenerate`
# diffs the live database against this, and the drift test does the same.
target_metadata = Base.metadata


def compare_options() -> dict:
    return {
        "target_metadata": target_metadata,
        # Notice column type changes (e.g. VARCHAR(100) -> VARCHAR(200)), not only
        # added and removed columns.
        "compare_type": True,
        # SQLite cannot ALTER most things in place; batch mode rebuilds the table
        # instead. It is a no-op on Postgres.
        "render_as_batch": True,
    }


def run_migrations_offline() -> None:
    """Emit the SQL instead of running it (`alembic upgrade head --sql`)."""
    context.configure(url=settings.sqlalchemy_url, literal_binds=True, dialect_opts={"paramstyle": "named"}, **compare_options())
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # When the app runs migrations at startup it hands over its own connection
    # (see app/migrations.py), so the whole upgrade shares one transaction.
    connection = config.attributes.get("connection")
    if connection is not None:
        context.configure(connection=connection, **compare_options())
        with context.begin_transaction():
            context.run_migrations()
        return

    engine = create_engine(settings.sqlalchemy_url)
    with engine.connect() as connection:
        context.configure(connection=connection, **compare_options())
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
