from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App configuration, loaded from environment variables (or a .env file).

    Keeping config in one typed object means a missing or malformed value fails
    loudly at startup instead of surfacing as a confusing bug later.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Origins allowed to call the API from a browser (comma-separated in the env).
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
