"""Error model (P2 §3).

Every error response has the envelope::

    {"error": {"code": str, "message": str, "fields"?: {path: msg}, "details"?: {...}}}

``ERROR_CATALOG`` is ported 1:1 from ``apps/web/src/lib/api/contracts/errors.ts`` (same codes,
statuses and messages) with the v3 changes of P2 §3.3 (``bad_origin``, ``pincode_state_mismatch``
and ``district_state_mismatch`` removed; new auth, maps and verification codes added).

Owner: D2. Other agents: ask D2 to add a code (send the code, status and default message).
"""

from __future__ import annotations

from typing import Any, Final

ERROR_CATALOG: Final[dict[str, tuple[int, str]]] = {
    # 400
    "invalid_request": (400, "Some details are missing or invalid. Please check and try again."),
    "idempotency_key_required": (400, "This request needs an Idempotency-Key header."),
    # 401
    "unauthenticated": (401, "Please sign in to continue."),
    "invalid_credentials": (401, "Phone number or password is incorrect."),
    "invalid_signature": (401, "Invalid signature."),
    "stale_timestamp": (401, "Request timestamp is too old."),
    "token_expired": (401, "Your session has expired. Please try again."),
    "session_revoked": (401, "You were signed out. Please sign in again."),
    "phone_proof_required": (401, "Please verify your phone number again."),
    # 403
    "forbidden": (403, "You don't have access to this."),
    "agency_not_verified": (403, "Your agency must be verified before you can do this."),
    "agency_suspended": (403, "Your agency is suspended. Contact support."),
    "driver_not_linked": (403, "You are not linked to an active agency yet."),
    "account_disabled": (403, "This account has been disabled. Contact support."),
    "password_login_required": (403, "Please sign in with your phone number and password."),
    "wrong_role": (403, "This number is registered for a different account type."),
    # 404 / 405
    "not_found": (404, "We couldn't find that."),
    "account_not_found": (404, "There is no TAKI account for this phone number."),
    "method_not_allowed": (405, "This method is not allowed here."),
    # 409
    "conflict": (409, "This was changed by someone else. Refresh and try again."),
    "contention": (409, "Too many people are updating this right now. Please try again."),
    "already_exists": (409, "This already exists."),
    "account_exists": (409, "This phone number already has a TAKI account. Please log in."),
    "invalid_transition": (409, "This action is no longer available for this booking."),
    "insufficient_capacity": (409, "Not enough capacity left on this trip."),
    "shipment_has_open_booking": (409, "This shipment already has an open booking request."),
    "already_paid": (409, "This booking is already paid."),
    "already_reviewed": (409, "You have already reviewed this delivery."),
    "already_verified": (409, "This document is already verified and can't be replaced."),
    "driver_schedule_conflict": (
        409,
        "The driver is already assigned to another trip at that time.",
    ),
    "vehicle_schedule_conflict": (
        409,
        "The vehicle is already booked for another trip at that time.",
    ),
    "driver_unavailable": (409, "This driver is not available for trips."),
    "driver_not_verified": (409, "This driver's documents are not verified yet."),
    "vehicle_unavailable": (409, "This vehicle is not active."),
    "vehicle_documents_missing": (409, "Upload this vehicle's RC before publishing the trip."),
    "phone_taken": (409, "This phone number is already registered. Please log in."),
    "registration_taken": (409, "A vehicle with this registration number already exists."),
    "trip_has_bookings": (409, "This trip has active bookings, so this change isn't allowed."),
    "trip_not_bookable": (409, "This trip is no longer accepting bookings."),
    "driver_has_active_trips": (409, "This driver is assigned to upcoming or active trips."),
    "vehicle_has_active_trips": (409, "This vehicle is assigned to upcoming or active trips."),
    "checkpoint_out_of_order": (409, "Update checkpoints in route order."),
    "undelivered_shipments": (
        409,
        "Deliver or close every shipment before completing the trip.",
    ),
    "otp_not_exhausted": (409, "The current code is still valid."),
    "refund_not_allowed": (409, "A refund can't be retried for this payment right now."),
    # 410
    "otp_expired": (410, "This code has expired. Request a new one."),
    "proof_expired": (410, "Verification expired. Please verify your phone again."),
    "payment_window_closed": (410, "The payment window for this booking has closed."),
    "request_expired": (410, "This booking request has expired."),
    # 413 / 415
    "file_too_large": (413, "That file is too large."),
    "unsupported_media_type": (415, "Unsupported content type."),
    # 422
    "not_on_route": (
        422,
        "This trip doesn't stop near your pickup and drop locations in that order.",
    ),
    "goods_not_accepted": (422, "This trip doesn't accept these goods."),
    "handling_not_supported": (422, "This trip can't provide the special handling you need."),
    "package_too_heavy": (422, "Your package is heavier than this trip allows per package."),
    "departed": (422, "This trip has already left your pickup point."),
    "otp_invalid": (422, "That code is incorrect."),
    "too_many_attempts": (422, "Too many incorrect attempts."),
    "too_many_resends": (422, "You've requested too many codes."),
    "idempotency_key_reused": (
        422,
        "This request key was already used for a different request.",
    ),
    "address_not_found": (422, "We couldn't find that address. Check it and try again."),
    "address_state_mismatch": (422, "The address doesn't belong to the selected state."),
    "outside_service_area": (
        422,
        "TAKI currently serves Tamil Nadu, Kerala, Karnataka, Telangana and Andhra Pradesh.",
    ),
    "past_date": (422, "Choose today or a later date."),
    "date_too_far": (422, "Choose a date within the next 60 days."),
    "too_early": (422, "It's too early for this step."),
    "proof_required": (422, "Add at least one delivery photo."),
    "underage": (422, "You must be at least 18 years old."),
    "invalid_document_number": (422, "That document number doesn't look right."),
    "file_invalid": (422, "That file type isn't supported."),
    "invalid_checkpoints": (422, "Check the route checkpoints and their timings."),
    "capacity_exceeds_vehicle": (422, "Offered capacity can't exceed the vehicle's payload."),
    "capacity_below_booked": (
        422,
        "Offered capacity can't be lower than what is already booked.",
    ),
    "amount_mismatch": (422, "The paid amount doesn't match the booking total."),
    # 423 / 429
    "account_locked": (423, "Too many failed attempts. Try again later."),
    "rate_limited": (429, "Too many requests. Please wait and try again."),
    "resend_cooldown": (429, "Please wait before requesting another code."),
    # 5xx
    "internal": (500, "Something went wrong on our side. Please try again."),
    "not_implemented": (501, "This feature is not available yet."),
    "payments_not_configured": (501, "Online payments are not configured for this deployment."),
    "webhook_not_configured": (
        501,
        "Payment webhooks are not configured for this deployment.",
    ),
    "gateway_error": (502, "The payment gateway didn't respond. Please try again."),
    "maps_unavailable": (502, "Google Maps didn't respond. Please try again."),
    "sms_not_configured": (503, "SMS is not configured for this deployment."),
    "database_unavailable": (
        503,
        "We can't reach our database right now. Please try again in a moment.",
    ),
    "cron_not_configured": (
        503,
        "The scheduled sweep is not configured for this deployment.",
    ),
    "maps_not_configured": (503, "Maps are not configured for this deployment."),
}


def status_for(code: str) -> int:
    return ERROR_CATALOG.get(code, (400, ""))[0]


def message_for(code: str) -> str:
    entry = ERROR_CATALOG.get(code)
    return entry[1] if entry else ERROR_CATALOG["internal"][1]


class AppError(Exception):
    """The one error type raised by app code. ``message`` is user-facing copy."""

    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        status: int | None = None,
        fields: dict[str, str] | None = None,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        if code not in ERROR_CATALOG:  # programming error: fail loudly
            raise KeyError(f"Unknown error code {code!r}; add it to ERROR_CATALOG")
        self.code = code
        self.message = message or message_for(code)
        self.status = status or status_for(code)
        self.fields = fields
        self.details = details
        self.headers = headers
        super().__init__(f"{code}: {self.message}")

    def body(self) -> dict[str, Any]:
        err: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields:
            err["fields"] = self.fields
        if self.details:
            err["details"] = self.details
        return {"error": err}


def not_found() -> AppError:
    return AppError("not_found")


def forbidden(message: str | None = None) -> AppError:
    return AppError("forbidden", message)
