"""Place lookups for the location picker. All of it reads our own copy of the dataset (see app/geo.py)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.geo import next_key, place_label, search_key
from app.models import City, Country, State
from app.schemas import CityMatch, CountryOut, StateOut

# Login required: the data is public, but there is no reason to offer an anonymous search endpoint.
router = APIRouter(prefix="/geo", tags=["geo"], dependencies=[Depends(get_current_user)])

DbSession = Annotated[Session, Depends(get_db)]


@router.get("/countries", response_model=list[CountryOut])
def countries(db: DbSession) -> list[Country]:
    """Every country and territory (about 250), for the country picker and filter."""
    return list(db.scalars(select(Country).order_by(Country.name)))


@router.get("/states", response_model=list[StateOut])
def states(db: DbSession, country_id: Annotated[int, Query(ge=1)]) -> list[State]:
    """The states, provinces or regions of one country, for the state filter."""
    return list(db.scalars(select(State).where(State.country_id == country_id).order_by(State.name)))


@router.get("/cities", response_model=list[CityMatch])
def cities(
    db: DbSession,
    country_id: Annotated[int, Query(ge=1)],
    q: Annotated[str, Query(min_length=2, max_length=100, description="What the name starts with; accents and case are ignored")],
    limit: Annotated[int, Query(ge=1, le=25)] = 10,
) -> list[CityMatch]:
    """Cities in a country whose name starts with `q`, biggest first.

    Every match carries its state, so two Springfields are two lines ("Springfield, Illinois" and
    "Springfield, Missouri"), and choosing one means choosing that exact row (its `id`). The dataset
    sometimes lists one place twice under the same name and state (once by hierarchy, once flat); those
    would be identical lines, so only the biggest is offered. Both rows stay in the table.
    """
    key = search_key(q)
    if not key:
        return []
    rows = db.scalars(
        select(City)
        .where(City.country_id == country_id, City.search_name >= key, City.search_name < next_key(key))
        # Biggest first (unknown sizes last, on both databases), then by name, with the id as a stable last word.
        .order_by(City.population.desc().nulls_last(), City.name, City.id)
        .limit(limit * 4)  # room to drop repeats and still fill the list
    )
    matches: list[CityMatch] = []
    seen: set[str] = set()
    for city in rows:
        label = place_label(city.name, city.state.name, city.country.name)
        if label in seen:
            continue
        seen.add(label)
        matches.append(CityMatch(id=city.id, name=city.name, state_id=city.state_id, state=city.state.name, label=label))
        if len(matches) == limit:
            break
    return matches
