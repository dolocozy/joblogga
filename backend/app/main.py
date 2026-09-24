import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import engine
from app.migrations import upgrade_database
from app.routers import applications, auth, stats


# Without this only warnings reach the host's log viewer. INFO adds the migration
# lines ("Running upgrade ... -> ...", "Existing database recognised") that show what
# each deploy changed in the database.
logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Applies any pending database migrations before serving traffic (see
    # app/migrations.py). If one fails, the app does not start.
    upgrade_database(engine)
    yield


app = FastAPI(title="Joblogga API", version="0.1.0", lifespan=lifespan)

# The browser blocks cross-origin requests by default. The frontend (Vite dev
# server on :5173) and the API (:8000) are different origins, so we explicitly
# allow the frontend's origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(applications.router)
app.include_router(stats.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
