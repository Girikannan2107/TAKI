"""Auth request/response models (contract §1.1, §4.1)."""

from __future__ import annotations

from pydantic import Field, field_validator, model_validator
from pydantic_core import PydanticCustomError
from pydantic_core.core_schema import ValidationInfo

from app.models.enums import DriverLinkStatus, Role, VehicleCountRange, VerificationStatus
from app.schemas.common import (
    AcceptTerms,
    AgencyId,
    CamelModel,
    Dob,
    InviteId,
    Name,
    Password,
    Phone,
    PlaceInput,
    StatesCovered,
    field_error,
)


def _confirm(v: str, info: ValidationInfo) -> str:
    pw = info.data.get("password")
    if pw is not None and v != pw:
        raise PydanticCustomError("password_mismatch", "Passwords don't match")
    return v


class _WithConfirm(CamelModel):
    password: Password
    confirm_password: str

    @field_validator("confirm_password")
    @classmethod
    def check_confirm(cls, v: str, info: ValidationInfo) -> str:
        return _confirm(v, info)


class CustomerSignupBody(_WithConfirm):
    full_name: Name("your full name")  # type: ignore[valid-type]
    dob: Dob
    accept_terms: AcceptTerms


class AgencySignupBody(_WithConfirm):
    owner_name: Name("the owner's name")  # type: ignore[valid-type]
    agency_name: Name("the agency name", 80)  # type: ignore[valid-type]
    base: PlaceInput
    vehicle_count_range: VehicleCountRange
    states_covered: StatesCovered
    accept_terms: AcceptTerms

    @field_validator("states_covered")
    @classmethod
    def unique_states(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


class DriverSignupBody(_WithConfirm):
    full_name: Name("your full name")  # type: ignore[valid-type]
    agency_id: AgencyId | None = None
    invite_id: InviteId | None = None
    accept_terms: AcceptTerms

    @model_validator(mode="after")
    def check_one_path(self) -> DriverSignupBody:
        if bool(self.agency_id) == bool(self.invite_id):
            raise field_error("agencyId", "Choose your agency")
        return self


class LoginBody(CamelModel):
    role: Role
    phone: Phone
    password: str = Field(min_length=1, max_length=64)


class ResetPasswordBody(_WithConfirm):
    pass


class ChangePasswordBody(CamelModel):
    current_password: str = Field(min_length=1, max_length=64)
    password: Password
    confirm_password: str

    @field_validator("confirm_password")
    @classmethod
    def check_confirm(cls, v: str, info: ValidationInfo) -> str:
        return _confirm(v, info)

    @field_validator("password")
    @classmethod
    def check_new_password(cls, v: str, info: ValidationInfo) -> str:
        if info.data.get("current_password") == v:
            raise PydanticCustomError("password_reused", "Choose a password you haven't used here")
        return v


class ChangePhoneBody(CamelModel):
    current_password: str = Field(min_length=1, max_length=64)


class LogoutBody(CamelModel):
    all_devices: bool = False


# ── Responses ─────────────────────────────────────────────────────────────────
class InviteSummary(CamelModel):
    invite_id: str
    agency_name: str
    full_name: str


class PhoneStatusResponse(CamelModel):
    phone: str
    phone_masked: str
    registered: bool
    role: Role | None = None
    invite: InviteSummary | None = None


class SessionAgency(CamelModel):
    id: str
    name: str
    verification: VerificationStatus
    reason: str | None = None


class SessionAgencyLink(CamelModel):
    agency_id: str
    agency_name: str
    status: DriverLinkStatus


class SessionDriver(CamelModel):
    agency_link: SessionAgencyLink | None = None
    verification: VerificationStatus


class SessionUserDTO(CamelModel):
    id: str
    role: Role
    name: str
    phone_masked: str
    photo_url: str | None = None
    agency: SessionAgency | None = None
    driver: SessionDriver | None = None
    claims_version: int


class AuthResultDTO(CamelModel):
    custom_token: str
    user: SessionUserDTO


class SessionResponse(CamelModel):
    user: SessionUserDTO | None = None
