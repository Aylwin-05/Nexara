from logging.config import fileConfig

from alembic import context
from app.core.config import settings
from app.database.base import Base

# Import all models here so Alembic can discover them
from app.models import *  # noqa: F403 - Alembic model discovery
from sqlalchemy import engine_from_config, pool

config = context.config

# Alembic uses a synchronous driver even though the application
# connects with asyncpg: rewrite `+asyncpg` -> `+psycopg2`.
sync_url = settings.DATABASE_URL.replace(
    "+asyncpg",
    "+psycopg2",
)

# Override the database URL from our application settings
config.set_main_option("sqlalchemy.url", sync_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""

    url = config.get_main_option("sqlalchemy.url")

    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
