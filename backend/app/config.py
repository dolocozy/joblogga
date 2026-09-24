from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env and the default SQLite file next to the backend folder, not the
# current directory, so they're the same no matter where the server is launched from.
BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"


def normalize_database_url(url: str) -> str:
    """Make a hosted-Postgres URL usable by SQLAlchemy with our driver (psycopg 3).

    Hosts hand out URLs that start with "postgres://" or "postgresql://", which
    SQLAlchemy would read as "use the psycopg2 driver". We install psycopg 3, so
    the driver has to be named explicitly. SQLite and already-explicit URLs pass
    through untouched.
    """
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


class Settings(BaseSettings):
    """App configuration, loaded from environment variables (or a .env file).

    Keeping config in one typed object means a missing or malformed value fails
    loudly at startup instead of surfacing as a confusing bug later.
    """

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # Origins allowed to call the API from a browser (comma-separated in the env).
    cors_origins: str = "http://localhost:5173"

    # SQLite file for local dev; set to a postgresql:// URL in production.
    database_url: str = f"sqlite:///{BACKEND_DIR / 'joblogga.db'}"

    # Signs JWTs. Deliberately has NO default: anyone who knows the key can forge
    # a login for any user, so we refuse to start rather than fall back to a
    # publicly-known value.
    secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    @property
    def sqlalchemy_url(self) -> str:
        return normalize_database_url(self.database_url)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()  # type: ignore[call-arg]  # secret_key comes from the environment
