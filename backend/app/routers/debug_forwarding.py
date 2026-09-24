"""TEMPORARY: shows the caller the forwarding headers their own request arrived
with, so the proxy chain in front of the API on Render can be measured instead of
guessed. It returns nothing but the caller's own request details. Delete this file
(and its include in main.py) once TRUSTED_PROXY_HOPS is settled."""

from fastapi import APIRouter, Request

router = APIRouter(prefix="/_debug", tags=["debug"], include_in_schema=False)

_HEADERS = ("x-forwarded-for", "x-real-ip", "cf-connecting-ip", "true-client-ip", "forwarded", "x-forwarded-proto", "via", "cf-ray")


@router.get("/forwarding")
def forwarding(request: Request) -> dict:
    return {
        "peer": request.client.host if request.client else None,
        "headers": {name: request.headers.get(name) for name in _HEADERS},
    }
