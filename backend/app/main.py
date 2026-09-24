from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(title="Joblogga API", version="0.1.0")

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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
