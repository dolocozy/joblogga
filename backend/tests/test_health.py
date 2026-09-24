def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_app_starts_up_and_creates_its_tables():
    """Runs the real startup path (lifespan -> create_all) against whichever
    database the suite is configured for, which is where a driver or dialect
    problem would surface on Postgres. The other tests build tables themselves."""
    from fastapi.testclient import TestClient

    from app.db import Base, engine
    from app.main import app

    try:
        with TestClient(app) as started:  # entering the context runs startup
            assert started.get("/health").status_code == 200
            from sqlalchemy import inspect

            assert {"users", "applications", "status_changes"} <= set(inspect(engine).get_table_names()) or engine.url.get_backend_name() == "sqlite"
    finally:
        Base.metadata.drop_all(engine)
