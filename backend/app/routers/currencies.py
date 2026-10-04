"""The currencies a salary can be in. Reference data held in code (app/currencies.py): nothing is converted."""

from fastapi import APIRouter, Depends

from app.currencies import COMMON, CURRENCIES
from app.deps import get_current_user
from app.schemas import CurrencyOut

# Login required, like the place lookups: the list is public, but there is no reason for an anonymous endpoint.
router = APIRouter(prefix="/currencies", tags=["currencies"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[CurrencyOut])
def currencies() -> list[CurrencyOut]:
    """Every currency code a salary can be recorded in, with its name. The common ones come first, then the rest by code."""
    rest = sorted(c for c in CURRENCIES if c not in COMMON)
    return [CurrencyOut(code=c, name=CURRENCIES[c], common=c in COMMON) for c in (*COMMON, *rest)]
