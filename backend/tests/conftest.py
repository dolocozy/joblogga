import os

# Must be set before `app` is imported: Settings() reads the environment at import time.
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production-use-0123456789"
# The suite runs on in-memory SQLite by default. CI also runs it on real Postgres
# (the production database) by setting TEST_DATABASE_URL.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite://")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import normalize_database_url
from app.db import Base, get_db
from app.main import app


@pytest.fixture
def client():
    """A test client backed by a fresh, empty database for each test."""
    if TEST_DATABASE_URL.startswith("sqlite"):
        # StaticPool keeps one shared connection; otherwise every new connection to
        # an in-memory SQLite DB would see its own empty database.
        engine = create_engine(
            TEST_DATABASE_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    else:
        engine = create_engine(normalize_database_url(TEST_DATABASE_URL))
        Base.metadata.drop_all(engine)  # start clean even if a previous run crashed
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
    if not TEST_DATABASE_URL.startswith("sqlite"):
        engine.dispose()  # release connections so drop_all is not blocked by open locks
        cleanup = create_engine(normalize_database_url(TEST_DATABASE_URL))
        Base.metadata.drop_all(cleanup)
        cleanup.dispose()
    engine.dispose()


def make_user(client, email="me@example.com", password="correct-horse-battery") -> dict:
    """Sign up + log in; returns headers for authenticated requests."""
    client.post("/auth/signup", json={"email": email, "password": password})
    token = client.post("/auth/login", json={"email": email, "password": password}).json()[
        "access_token"
    ]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth(client):
    return make_user(client)


@pytest.fixture
def other_auth(client):
    return make_user(client, email="other@example.com")
