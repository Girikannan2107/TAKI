"""Business constants (ported from ``apps/web/src/lib/domain/constants.ts`` + P2)."""

from __future__ import annotations

from typing import Final

MIN_AGE_YEARS: Final = 18
UNDERAGE_MESSAGE: Final = "You must be 18 or older to use TAKI"

# Login lockout (v2 LOGIN_LOCK): 5 consecutive failures → locked for 15 minutes.
LOGIN_LOCK_MAX_FAILURES: Final = 5
LOGIN_LOCK_MINUTES: Final = 15

PASSWORD_MIN: Final = 8
PASSWORD_MAX: Final = 64

# Phone-proof tokens must be fresh (P2 §5.2).
PHONE_PROOF_MAX_AGE_SECONDS: Final = 600

# Custom-claims schema version (SessionUserDTO.claimsVersion).
CLAIMS_VERSION: Final = 1

# Rate limits (P2 §5.8): (limit, window seconds).
RATE_LIMITS: Final[dict[str, tuple[int, int]]] = {
    "login_ip": (30, 900),
    "login_phone": (10, 900),
    "phone_proof_uid": (10, 3600),
    "password_change_uid": (10, 3600),
    "booking_create_uid": (30, 3600),
    "payment_create_uid": (20, 3600),
    "payment_verify_uid": (120, 3600),
    "upload_uid": (60, 3600),
    "maps_uid": (120, 3600),
    "search_ip": (120, 3600),
    "contact_ip": (5, 3600),
}

# Uploads (P2 §12.2).
MAX_JSON_BYTES: Final = 1024 * 1024
MAX_MULTIPART_BYTES: Final = 20 * 1024 * 1024
DOCUMENT_BYTES: Final = 5 * 1024 * 1024
PHOTO_BYTES: Final = 5 * 1024 * 1024
PROOF_BYTES: Final = 8 * 1024 * 1024
MAX_PROOF_FILES: Final = 3

FILE_URL_TTL_SECONDS: Final = 3600

# Meta / limits (E3).
LIMITS: Final = {
    "weightKg": {"min": 10, "max": 25_000},
    "bookingWindowDays": 60,
    "maxCheckpoints": 10,
    "serviceRadiusKm": {"min": 2, "max": 15, "default": 10},
    "ratePerKmPaise": {"min": 100, "max": 10_000},
    "ratePerKgPaise": {"min": 0, "max": 2_000},
    "maxAdditionalCharges": 5,
}

STATE_NAMES: Final[dict[str, str]] = {
    "TN": "Tamil Nadu",
    "KL": "Kerala",
    "KA": "Karnataka",
    "TG": "Telangana",
    "AP": "Andhra Pradesh",
}
