from datetime import date, datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.models import ApplicationStatus, WorkMode


def validate_new_password(v: str) -> str:
    """The rules for choosing a password (signup and password reset share them)."""
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    # bcrypt only uses the first 72 bytes and newer versions reject longer
    # input, so we refuse it up front rather than silently truncating.
    if len(v.encode()) > 72:
        raise ValueError("Password must be at most 72 bytes")
    return v


class SignupRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        # Emails are case-insensitive in practice; store one canonical form so
        # "Me@X.com" and "me@x.com" can't become two accounts.
        return v.lower()

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return validate_new_password(v)


class PasswordResetRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.lower()


class PasswordResetConfirm(BaseModel):
    # Bounded so an absurd value can't be used to make the server hash megabytes.
    token: str = Field(min_length=20, max_length=200)
    password: str

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return validate_new_password(v)


class DeleteAccountRequest(BaseModel):
    # Asked for again even though they are logged in: deleting is irreversible, and a
    # borrowed laptop or a stolen token should not be enough to do it.
    password: str = Field(max_length=200)


class EmailVerificationConfirm(BaseModel):
    token: str = Field(min_length=20, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.lower()


class UserOut(BaseModel):
    # Response model: deliberately omits hashed_password so it can never leak.
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    created_at: datetime
    # Lets the UI show "please verify your email" without a second request.
    email_verified: bool



class MessageResponse(BaseModel):
    detail: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# --- applications -------------------------------------------------------------


def _blank_to_none(v: object) -> object:
    """Trim strings; treat "" as "not provided". HTML forms send empty strings."""
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


# Required text: trimmed, and must not be empty.
RequiredText = Annotated[str, Field(min_length=1, max_length=200), BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v)]
def optional_text(max_length: int):
    """Optional text: trimmed, blank becomes None, and the length limit applies
    only to real strings (the constraint sits on the `str` branch, not on None)."""
    return Annotated[Annotated[str, Field(max_length=max_length)] | None, BeforeValidator(_blank_to_none)]


# Far more rounds than any real process; the cap only stops nonsense.
MAX_ROUNDS = 50
# A whole number, and strictly so: JSON true would otherwise pass for 1.
Round = Annotated[int, Field(strict=True, ge=1, le=MAX_ROUNDS)] | None


def _check_http_url(v: str | None) -> str | None:
    # Only http(s). The frontend renders this as a clickable link, and a stored
    # "javascript:..." URL would run script when clicked (stored XSS).
    if v is not None and not v.lower().startswith(("http://", "https://")):
        raise ValueError("Job link must start with http:// or https://")
    return v


class ApplicationFields(BaseModel):
    """Fields shared by create and update, with all the validation rules."""

    company: RequiredText
    role: RequiredText
    job_url: optional_text(2048) = None
    # Omitted or null means today, except for a Saved job, which has no applied date yet.
    date_applied: date | None = None
    resume_version: optional_text(100) = None
    salary_min: int | None = Field(default=None, ge=0)
    salary_max: int | None = Field(default=None, ge=0)
    location: optional_text(200) = None
    work_mode: WorkMode | None = None  # None = not specified
    notes: optional_text(10000) = None
    interview_round: Round = None  # which round you are in
    interview_rounds_total: Round = None  # how many there will be, if known
    status: ApplicationStatus = ApplicationStatus.APPLIED
    follow_up_date: date | None = None

    @field_validator("job_url")
    @classmethod
    def job_url_is_http(cls, v: str | None) -> str | None:
        return _check_http_url(v)


class ApplicationCreate(ApplicationFields):
    @model_validator(mode="after")
    def salary_range_is_ordered(self) -> "ApplicationCreate":
        check_salary_range(self.salary_min, self.salary_max)
        check_rounds(self.interview_round, self.interview_rounds_total)
        return self

    @model_validator(mode="after")
    def applied_date_defaults_to_today(self) -> "ApplicationCreate":
        if self.date_applied is None and self.status != ApplicationStatus.SAVED:
            self.date_applied = date.today()
        return self


class ApplicationUpdate(BaseModel):
    """PATCH body: every field optional; only the fields sent are changed."""

    company: RequiredText | None = None
    role: RequiredText | None = None
    job_url: optional_text(2048) = None
    date_applied: date | None = None
    resume_version: optional_text(100) = None
    salary_min: int | None = Field(default=None, ge=0)
    salary_max: int | None = Field(default=None, ge=0)
    location: optional_text(200) = None
    work_mode: WorkMode | None = None  # sending null clears it back to "not specified"
    notes: optional_text(10000) = None
    interview_round: Round = None  # null clears it
    interview_rounds_total: Round = None
    status: ApplicationStatus | None = None
    follow_up_date: date | None = None

    @field_validator("job_url")
    @classmethod
    def job_url_is_http(cls, v: str | None) -> str | None:
        return _check_http_url(v)

    @model_validator(mode="after")
    def required_fields_not_null(self) -> "ApplicationUpdate":
        # For optional columns, sending null means "clear it". For columns that
        # must always have a value, explicitly sending null is an error.
        # date_applied may be null: a Saved job has none. Whether that is allowed for the
        # resulting status is decided in the router, which knows the stored status too.
        for name in ("company", "role", "status"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


def check_salary_range(low: int | None, high: int | None) -> None:
    if low is not None and high is not None and low > high:
        raise ValueError("salary_min cannot be greater than salary_max")


def check_rounds(current: int | None, total: int | None) -> None:
    if current is not None and total is not None and current > total:
        raise ValueError("interview_round cannot be greater than interview_rounds_total")


class StatusChangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    from_status: ApplicationStatus | None
    to_status: ApplicationStatus
    changed_at: datetime


class ApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company: str
    role: str
    job_url: str | None
    date_applied: date | None  # None while the job is Saved
    resume_version: str | None
    salary_min: int | None
    salary_max: int | None
    location: str | None
    work_mode: WorkMode | None
    notes: str | None
    interview_round: int | None
    interview_rounds_total: int | None
    status: ApplicationStatus
    follow_up_date: date | None
    created_at: datetime
    updated_at: datetime


class ApplicationDetail(ApplicationOut):
    history: list[StatusChangeOut]


class ApplicationList(BaseModel):
    items: list[ApplicationOut]
    total: int  # matches ignoring limit/offset, so the UI can paginate


# --- stats --------------------------------------------------------------------


class StatusCount(BaseModel):
    status: ApplicationStatus
    count: int


class ResponseRate(BaseModel):
    responded: int  # numerator
    eligible: int  # denominator
    # responded / eligible as a fraction 0..1, or None when nothing is eligible
    # yet. None is deliberately not 0: "no data" and "0% replied" are different.
    rate: float | None


class NoReply(BaseModel):
    days: int
    count: int  # applications still at Applied at least `days` days after their date applied


class WeekCount(BaseModel):
    week_start: date  # the Monday that starts the week
    count: int


class StatsOut(BaseModel):
    total: int
    by_status: list[StatusCount]  # every status except Saved, in pipeline order (Saved is not an application yet)
    response: ResponseRate
    per_week: list[WeekCount]  # oldest first, empty weeks included as 0
    no_reply: NoReply
