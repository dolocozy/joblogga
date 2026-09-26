from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.export import applications_to_csv
from app.deps import get_current_user
from app.models import Application, ApplicationStatus, StatusChange, User, WorkMode
from app.schemas import (
    ApplicationCreate,
    ApplicationDetail,
    ApplicationList,
    ApplicationOut,
    ApplicationUpdate,
    check_salary_range,
)

router = APIRouter(prefix="/applications", tags=["applications"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

# Once an application is closed there's nothing left to follow up on.
CLOSED_STATUSES = (
    ApplicationStatus.OFFER_ACCEPTED,
    ApplicationStatus.OFFER_DECLINED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.WITHDRAWN,
)


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
    app = Application(**body.model_dump(), user_id=user.id)
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
    work_mode: Annotated[list[WorkMode] | None, Query(description="Only these work modes (repeat the parameter for several)")] = None,
    company: Annotated[str | None, Query(max_length=200, description="Company contains…")] = None,
    q: Annotated[str | None, Query(max_length=200, description="Keyword in company, role, location or notes")] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ApplicationList:
    # Start from "this user's rows", then narrow with whichever filters were sent.
    conditions = [Application.user_id == user.id]
    if status_in:
        conditions.append(Application.status.in_(status_in))
    if work_mode:
        conditions.append(Application.work_mode.in_(work_mode))
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
                Application.notes.icontains(q, autoescape=True),
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
        .options(selectinload(Application.history))
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
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e))

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
    return app


@router.delete("/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(application_id: int, db: DbSession, user: CurrentUser) -> None:
    app = get_owned_application(db, user, application_id)
    db.delete(app)
    db.commit()
