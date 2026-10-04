from datetime import date, timedelta
import enum
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.duplicates import find_duplicates
from app.export import applications_to_csv
from app.deps import get_current_user
from app.geo import place_label
from app.importer import ImportFileError, import_csv
from app.contacts import MAX_CONTACTS
from app.models import CLOSED_STATUSES, Application, ApplicationContact, ApplicationStatus, ApplicationTag, City, Country, StatusChange, User, WorkMode
from app.tags import normalize_tag
from app.schemas import (
    ApplicationCreate,
    ApplicationDetail,
    ApplicationList,
    ApplicationOut,
    ApplicationUpdate,
    ContactIn,
    ContactOut,
    ContactUpdate,
    DuplicateOut,
    ImportResultOut,
    TagCount,
    check_rounds,
    check_salary_range,
)

router = APIRouter(prefix="/applications", tags=["applications"])


class ArchivedFilter(enum.StrEnum):
    """Which applications a list shows. Archiving is a view preference, so the default simply leaves them out."""

    HIDE = "hide"  # the default: only applications that are not archived
    INCLUDE = "include"  # both
    ONLY = "only"  # just the archived ones

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]



def resolve_place(db: Session, changes: dict, current: Application | None) -> None:
    """Make the place fields of a create or update consistent, editing `changes` in place.

    The client sends what the person chose: a city (which fixes the state and country), a country
    alone, or neither, plus any typed text. This checks the ids are real dataset rows and keeps them
    consistent: a city's country is always its own, and a picked city's readable `location` is
    generated here, never trusted from the client, so the text can never disagree with the id.
    Only runs when a place field was actually sent, so an edit to something else leaves it alone.
    """
    if "city_id" not in changes and "country_id" not in changes:
        return
    city_id = changes["city_id"] if "city_id" in changes else (current.city_id if current else None)
    # A newly chosen city brings its own country, so the stored country is not compared against it. Only a country the
    # client sent in this request is, and a country change with the old city left in place is a mismatch.
    if "country_id" in changes:
        country_id = changes["country_id"]
    elif "city_id" in changes:
        country_id = None
    else:
        country_id = current.country_id if current else None
    country = None
    if country_id is not None:
        country = db.get(Country, country_id)
        if country is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown country")
    if city_id is not None:
        city = db.get(City, city_id)
        if city is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown city")
        if country is not None and country.id != city.country_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That city is not in that country")
        changes["country_id"] = city.country_id
        changes["city_id"] = city.id
        changes["location"] = place_label(city.name, city.state.name, city.country.name)


def get_owned_application(db: Session, user: User, application_id: int) -> Application:
    """Fetch an application only if it belongs to `user`.

    Someone else's application gets the same 404 as one that doesn't exist, so
    the API never confirms which IDs are in use by other people.
    """
    app = db.scalar(
        select(Application).where(Application.id == application_id, Application.user_id == user.id)
    )
    if app is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Application not found")
    return app


@router.post("", response_model=ApplicationDetail, status_code=status.HTTP_201_CREATED)
def create_application(body: ApplicationCreate, db: DbSession, user: CurrentUser) -> Application:
    data = body.model_dump()
    resolve_place(db, data, None)
    tags = data.pop("tags")
    app = Application(**data, user_id=user.id)
    app.set_tags(tags)
    # The first history row records where the application started (from = None).
    app.history.append(StatusChange(from_status=None, to_status=app.status))
    db.add(app)
    db.commit()
    return app


@router.get("", response_model=ApplicationList)
def list_applications(
    db: DbSession,
    user: CurrentUser,
    status_in: Annotated[list[ApplicationStatus] | None, Query(alias="status")] = None,
    tag: Annotated[list[str] | None, Query(description="Only applications with this tag (repeat the parameter to require several)")] = None,
    archived: Annotated[ArchivedFilter, Query(description="hide (default), include, or only archived applications")] = ArchivedFilter.HIDE,
    work_mode: Annotated[list[WorkMode] | None, Query(description="Only these work modes (repeat the parameter for several)")] = None,
    country_id: Annotated[int | None, Query(ge=1, description="Only this country (a picked city or country)")] = None,
    state_id: Annotated[int | None, Query(ge=1, description="Only places in this state or province")] = None,
    company: Annotated[str | None, Query(max_length=200, description="Company contains…")] = None,
    q: Annotated[str | None, Query(max_length=200, description="Keyword in company, role, location (city, state or country), tags or notes")] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ApplicationList:
    # Start from "this user's rows", then narrow with whichever filters were sent.
    conditions = [Application.user_id == user.id]
    if archived == ArchivedFilter.HIDE:
        conditions.append(Application.archived_at.is_(None))
    elif archived == ArchivedFilter.ONLY:
        conditions.append(Application.archived_at.is_not(None))
    for wanted in {normalize_tag(t) for t in tag or []} - {""}:
        # An application must carry every tag asked for. (Matched on the normalised form, so "Dream Job" finds "dream job".)
        conditions.append(Application.tag_links.any(ApplicationTag.tag == wanted))
    if status_in:
        conditions.append(Application.status.in_(status_in))
    if work_mode:
        conditions.append(Application.work_mode.in_(work_mode))
    if country_id:
        conditions.append(Application.country_id == country_id)
    if state_id:
        # A state is known only through a picked city, so this is "the city is one of that state's".
        conditions.append(Application.city_id.in_(select(City.id).where(City.state_id == state_id)))
    if company:
        # autoescape: a user typing "%" or "_" searches for those characters
        # literally instead of them acting as SQL wildcards.
        conditions.append(Application.company.icontains(company, autoescape=True))
    if q:
        conditions.append(
            or_(
                Application.company.icontains(q, autoescape=True),
                Application.role.icontains(q, autoescape=True),
                Application.location.icontains(q, autoescape=True),
                # A typed place with a picked country ("Somewhere" + Canada) is still found by "canada".
                Application.country.has(Country.name.icontains(q, autoescape=True)),
                Application.notes.icontains(q, autoescape=True),
                Application.tag_links.any(ApplicationTag.tag.icontains(q, autoescape=True)),
            )
        )
    if date_from:
        conditions.append(Application.date_applied >= date_from)
    if date_to:
        conditions.append(Application.date_applied <= date_to)

    total = db.scalar(select(func.count()).select_from(Application).where(*conditions)) or 0
    items = db.scalars(
        select(Application)
        .where(*conditions)
        # Newest first; id breaks ties so paging is stable. Saved jobs have no date: NULLS LAST
        # says where they go, because Postgres and SQLite otherwise disagree.
        .order_by(Application.date_applied.desc().nulls_last(), Application.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return ApplicationList(items=[ApplicationOut.model_validate(i) for i in items], total=total)


# Declared BEFORE "/{application_id}" so "export.csv" and "upcoming" aren't parsed as ids.
@router.get("/export.csv")
def export_applications(db: DbSession, user: CurrentUser) -> Response:
    """Every one of the user's applications as a CSV file (their backup).

    Deliberately ignores list filters: an export that silently leaves rows out
    would be a poor backup.
    """
    applications = db.scalars(
        select(Application)
        .where(Application.user_id == user.id)
        # Load each application's history in one extra query, not one per row.
        .options(selectinload(Application.history), selectinload(Application.contacts))
        .order_by(Application.date_applied.desc().nulls_last(), Application.id.desc())
    ).all()
    filename = f"joblogga-applications-{date.today().isoformat()}.csv"
    return Response(
        content=applications_to_csv(applications),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Personal data: browsers and proxies should not keep a copy.
            "Cache-Control": "no-store",
        },
    )


@router.post("/import", response_model=ImportResultOut)
def import_applications(
    db: DbSession,
    user: CurrentUser,
    # Optional so an empty upload reaches the importer, which says "The file is empty." in plain words.
    data: Annotated[bytes, Body(media_type="text/csv", description="The CSV file's bytes, sent as text/csv")] = b"",
    skip_duplicates: Annotated[bool, Query(description="Leave out rows that repeat an application you already have (or an earlier row)")] = True,
) -> ImportResultOut:
    """Add the applications in a CSV file (the export's layout round-trips). Imports what it can and reports the rest.

    One transaction: either every importable row is added or, if something goes wrong, none is. A file that cannot be
    read at all (empty, no Company or Role column, too many rows) is refused with a message and nothing is added.
    """
    try:
        result = import_csv(db, user.id, data, skip_duplicates=skip_duplicates)
    except ImportFileError as error:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error))
    db.commit()
    return ImportResultOut.model_validate(result, from_attributes=True)


# Declared BEFORE "/{application_id}" so "tags" isn't parsed as an id.
@router.get("/tags", response_model=list[TagCount])
def my_tags(db: DbSession, user: CurrentUser) -> list[TagCount]:
    """Every tag this user has used, with how many applications carry it: for the tag filter and for suggestions."""
    rows = db.execute(
        select(ApplicationTag.tag, func.count())
        .join(Application, Application.id == ApplicationTag.application_id)
        .where(Application.user_id == user.id)
        .group_by(ApplicationTag.tag)
        .order_by(ApplicationTag.tag)
    )
    return [TagCount(tag=tag, count=count) for tag, count in rows]


# Declared BEFORE "/{application_id}" so "duplicates" isn't parsed as an id.
@router.get("/duplicates", response_model=list[DuplicateOut])
def duplicate_applications(
    db: DbSession,
    user: CurrentUser,
    company: Annotated[str, Query(min_length=1, max_length=200)],
    role: Annotated[str, Query(min_length=1, max_length=200)],
    exclude_id: Annotated[int | None, Query(ge=1, description="The application being edited, so it does not match itself")] = None,
) -> list[DuplicateOut]:
    """The user's other applications for this company and role, for the "you already have this" warning.

    Case and extra spaces are ignored; nothing fuzzier. This only informs: saving never depends on it.
    """
    return [DuplicateOut.model_validate(d) for d in find_duplicates(db, user.id, company, role, exclude_id)[:5]]


# Declared BEFORE "/{application_id}" so "upcoming" isn't parsed as an id.
@router.get("/upcoming", response_model=list[ApplicationOut])
def upcoming_follow_ups(
    db: DbSession,
    user: CurrentUser,
    days: Annotated[int, Query(ge=0, le=365)] = 7,
) -> list[Application]:
    """Open applications whose follow-up date is overdue or due within `days`."""
    horizon = date.today() + timedelta(days=days)
    return list(
        db.scalars(
            select(Application)
            .where(
                Application.user_id == user.id,
                Application.follow_up_date.is_not(None),
                Application.follow_up_date <= horizon,
                Application.status.not_in(CLOSED_STATUSES),
                Application.archived_at.is_(None),  # archived means "stop showing me this"
            )
            .order_by(Application.follow_up_date, Application.id)
        )
    )


@router.get("/{application_id}", response_model=ApplicationDetail)
def get_application(application_id: int, db: DbSession, user: CurrentUser) -> Application:
    return get_owned_application(db, user, application_id)


@router.patch("/{application_id}", response_model=ApplicationDetail)
def update_application(
    application_id: int, body: ApplicationUpdate, db: DbSession, user: CurrentUser
) -> Application:
    app = get_owned_application(db, user, application_id)
    # exclude_unset: only fields the client actually sent. That's what lets
    # PATCH tell "leave it alone" (absent) apart from "clear it" (null).
    changes = body.model_dump(exclude_unset=True)

    # The salary check must consider the merged result, e.g. sending only
    # salary_min must still be compared to the stored salary_max.
    try:
        check_salary_range(
            changes.get("salary_min", app.salary_min), changes.get("salary_max", app.salary_max)
        )
        # Likewise the rounds: the round you send is compared with the total already stored.
        check_rounds(
            changes.get("interview_round", app.interview_round),
            changes.get("interview_rounds_total", app.interview_rounds_total),
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e))

    resolve_place(db, changes, app)

    tags = changes.pop("tags", None)
    if tags is not None:
        app.set_tags(tags)

    # Archiving is its own switch: only an `archived` in the request changes it, and archiving twice keeps the
    # first time. Nothing else (a status change, an edit) touches it.
    archive = changes.pop("archived", None)
    if archive is True and app.archived_at is None:
        app.archived_at = datetime.now(UTC)
    elif archive is False:
        app.archived_at = None

    new_status = changes.pop("status", None)
    resulting_status = new_status if new_status is not None else app.status
    resulting_date = changes["date_applied"] if "date_applied" in changes else app.date_applied
    if resulting_date is None and resulting_status != ApplicationStatus.SAVED:
        if app.status == ApplicationStatus.SAVED:
            # Applying to a saved job: it is applied today unless the client said otherwise.
            changes["date_applied"] = date.today()
        else:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="date_applied cannot be empty once you have applied")
    for field, value in changes.items():
        setattr(app, field, value)
    if new_status is not None and new_status != app.status:
        app.history.append(StatusChange(from_status=app.status, to_status=new_status))
        app.status = new_status
    db.commit()
    # The place relationships were loaded before the change; reload so the response shows the new city and country.
    db.refresh(app)
    return app


def get_owned_contact(db: Session, application: Application, contact_id: int) -> ApplicationContact:
    """A contact of this application. Anything else (another application's contact, a missing one) is the same 404."""
    contact = db.scalar(
        select(ApplicationContact).where(ApplicationContact.id == contact_id, ApplicationContact.application_id == application.id)
    )
    if contact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Contact not found")
    return contact


@router.post("/{application_id}/contacts", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def add_contact(application_id: int, body: ContactIn, db: DbSession, user: CurrentUser) -> ApplicationContact:
    """Add a person you have dealt with at this application's company."""
    app = get_owned_application(db, user, application_id)
    if len(app.contacts) >= MAX_CONTACTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"An application can have at most {MAX_CONTACTS} contacts")
    contact = ApplicationContact(application_id=app.id, **body.model_dump())
    db.add(contact)
    db.commit()
    return contact


@router.patch("/{application_id}/contacts/{contact_id}", response_model=ContactOut)
def update_contact(application_id: int, contact_id: int, body: ContactUpdate, db: DbSession, user: CurrentUser) -> ApplicationContact:
    contact = get_owned_contact(db, get_owned_application(db, user, application_id), contact_id)
    for field, value in body.model_dump(exclude_unset=True).items():  # only what was sent; null clears an optional field
        setattr(contact, field, value)
    db.commit()
    return contact


@router.delete("/{application_id}/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(application_id: int, contact_id: int, db: DbSession, user: CurrentUser) -> None:
    contact = get_owned_contact(db, get_owned_application(db, user, application_id), contact_id)
    db.delete(contact)
    db.commit()


@router.delete("/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(application_id: int, db: DbSession, user: CurrentUser) -> None:
    app = get_owned_application(db, user, application_id)
    db.delete(app)
    db.commit()
