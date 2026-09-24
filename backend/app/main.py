from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.config import settings
from app.db import Base, engine
from app.routers import auth


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Creates any missing tables at startup. Fine while the schema is tiny; we'll
    # switch to Alembic migrations once we need to change existing tables.
    Base.metadata.create_all(engine)
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
