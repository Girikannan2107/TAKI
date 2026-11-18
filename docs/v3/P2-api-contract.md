# TAKI v3 — REST API Contract (FastAPI, `/api/v1`)

Author: P2. Date: 2026-11-15. Companion: `docs/v3/P2-architecture.md` (§ references below point there as "A§").

This is the implementation contract for D1–D5. **Every one of today's 102 Next.js route files is mapped in the "Replaces" column and in Appendix A.** Nothing is dropped silently; each removal is listed with its reason.

**DTO baseline rule:** where a response is described as "`XxxDTO` (TS)", the TypeScript interface of that name in `apps/web/src/lib/api/contracts/*.ts` (today `src/lib/api/contracts/*.ts`) is **normative**. The Pydantic response model must serialise to exactly that shape, plus or minus the deltas listed here. §2 lists the global deltas that apply to every DTO.

---

## 0. Conventions

| Topic | Rule |
|---|---|
| Base URL | `{API_BASE}/api/v1`. Production `https://api.<domain>/api/v1`. Local `http://localhost:8000/api/v1`, or `/api/v1` through the Next rewrite. |
| Content | `application/json; charset=utf-8` in both directions. Bodies marked ⓜ are `multipart/form-data`. JSON bodies are limited to 1 MB and multipart to 20 MB (413 `file_too_large`). A wrong content type returns 415 `unsupported_media_type`. |
| Casing | camelCase JSON. Enum values are snake_case strings, as today. |
| Auth header | `Authorization: Bearer <Firebase ID token>`. **S** = session token (custom-token sign-in, A§5.2). **P** = phone-proof token (phone sign-in, `auth_time` ≤ 10 min). |
| Roles column | `public` (no token; an optional S token is used when present), `any` (any S token), `customer`, `agency`, `driver`, `admin`, `P` (phone-proof), `system` (webhook or scheduler auth). |
| Other headers | `Idempotency-Key` (required where marked 🔑): `^[A-Za-z0-9_.:-]{8,128}$`. `X-Phone-Proof: <P token>` (phone change). `X-Request-ID` is optional in and always echoed out. |
| Success | 200 with the resource; 201 on create; 204 with an empty body. Every response has `Cache-Control: no-store` unless stated. |
| Error | `{"error":{"code":str,"message":str,"fields"?:{path:msg},"details"?:{…}}}`. The status comes from the catalog (A§3). Common codes on **every** authenticated endpoint are not repeated in the tables: 401 `unauthenticated` / `token_expired` / `session_revoked`, 403 `forbidden` / `password_login_required` / `account_disabled`, 400 `invalid_request`, 429 `rate_limited` (where rate-limited), 503 `database_unavailable`, 500 `internal`. |
| Not found | A missing **or not visible** resource, or a malformed path id, returns 404 `not_found`. |
| Pagination | Query `limit` (int 1–50, default 20) and `cursor` (opaque string ≤ 512). Response `{"items":[…],"nextCursor":str|null}`. Endpoints marked "bounded" return `{"items":[…]}` with no cursor. |
| Time | Output instants are ISO-8601 UTC with `Z`. Input instants must carry an offset (`Z` or `+05:30`). Date-only fields are `YYYY-MM-DD` in the IST calendar. |
| Money | Integer rupees for amounts (`*Rupees`, `amount`, `totalPayable`) and integer paise for rates (`*Paise`). |
| Files | File references in responses are `{"fileId": str, "url": str}`. `url` is a signed content URL valid for 60 min (A§12.2). Clients must not cache it longer, and use `GET /files/{fileId}` to refresh it. |

### 0.1 Validation primitives (`schemas/common.py`)

| Name | Rule (input → stored) | Error message |
|---|---|---|
| `Phone` | Strip spaces and `-`. `+91…`, `91…` (12 digits) or `0…` (11 digits) → 10 digits matching `^[6-9]\d{9}$` → E.164 `+91XXXXXXXXXX` | "Enter a valid 10-digit mobile number" |
| `Password` | 8–64 chars, ≥ 1 letter `[A-Za-z]`, ≥ 1 digit, must not equal the phone's 10 digits | "Use at least 8 characters" / "Include a letter" / "Include a number" |
| `ConfirmPassword` | Equals `password` (error on `confirmPassword`) | "Passwords don't match" |
| `Name(max=60)` | Trim; collapse whitespace; 2..max chars | "Enter …" |
| `Dob` | `YYYY-MM-DD`, ≥ `1900-01-01`, not in the future, **age ≥ 18 on today's IST date**: `dob ≤ maxDob(today)`, where `maxDob` = today − 18 years and Feb 29 maps to Feb 28. Server error code `underage` (422) when only the age fails. | "You must be 18 or older to use TAKI" |
| `Pincode` | Trim, `^[1-9][0-9]{5}$`. **Format only; never used for matching.** | "Enter a 6-digit pincode" |
| `StateCode` | `TN, KL, KA, TG, AP` (`SERVICE_STATES`) | — |
| `Lat` / `Lng` | Float, lat 6.0–37.6, lng 68.0–97.5 (India bounding box) | "Location is outside India" |
| `PlaceId` | String 10–300 chars `^[A-Za-z0-9_-]+$` (Google place id) | — |
| `IsoDate` / `IsoDateTime` | RFC 3339. Datetimes require an offset. | — |
| `ShippingDate` | `IsoDate`, IST today ≤ d ≤ today + 60 | `past_date` / `date_too_far` (422) |
| `WeightKg` | int 10–25 000 | "Minimum 10 kg" / "Maximum 25,000 kg" |
| `Pieces` | int 1–500 | — |
| `Reason` | Trim, 3–300 chars | "Give a short reason (at least 3 characters)" |
| `Remarks` | Trim, ≤ 300, optional | — |
| `OtpCode` | `^\d{6}$` | "Enter the 6-digit code" |
| `Registration` | Upper-case, strip non-alphanumerics. `^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$` → `"TN 37 XX 4587"`, or BH series `^(\d{2})BH(\d{4})([A-Z]{1,2})$` → `"22 BH 1234 AA"` (port of `normalizeReg`) | "Enter a valid registration number, e.g. TN 37 XX 4587" |
| `AadhaarNumber` | Digits only, `^[2-9]\d{11}$` and Verhoeff-valid | `invalid_document_number` (422) |
| `PanNumber` | Upper-case, `^[A-Z]{5}\d{4}[A-Z]$` | `invalid_document_number` |
| `DlNumber` | Upper-case, strip non-alphanumerics, `^[A-Z0-9]{10,20}$` | `invalid_document_number` |
| Ids | Agency `^agc_[a-z0-9]{20}$`; vehicle `veh_`; trip `trp_`; shipment `shp_`; invite `inv_`; file `fil_`; notification `ntf_`; payment `pay_`; settlement `stl_`. **User / driver / customer id: Firebase uid `^[A-Za-z0-9]{1,128}$`.** Booking `^TAKI\d{8}$`. | 404 when used in a path |

### 0.2 Enums (unchanged unless marked)

- `GoodsCategory`: `general_goods, agriculture, construction, industrial, electronics, furniture, textiles, perishables, other`
- `PackageType`: `box, bag, sack, crate, pallet, loose, other`
- `SpecialHandling`: `fragile, keep_dry, this_side_up, temperature_sensitive`
- `VehicleClass`: `"Mini Truck", "Pickup", "Light Truck", "Medium Truck", "Heavy Truck"`
- `BodyType`: `open, tarpaulin, closed, container`
- `VehicleCountRange`: `1-5, 6-10, 11-25, 26-50, 50+`
- `VehicleModelId`: `tata_ace, mahindra_bolero_pickup, tata_407, eicher_pro, ashok_leyland_ecomet`
- `BookingStatus` (derived): `awaiting_agency, pending_payment, payment_failed, confirmed, picked_up, in_transit, out_for_delivery, delivered, rejected, cancelled`
- `CustomerTab`: `pending, confirmed, picked_up, in_transit, delivered, rejected, cancelled`
- `AgencyBookingTab`: `pending, accepted, confirmed, rejected, cancelled`
- `DriverShipmentTab`: `pending_pickup, in_transit, delivered`
- **New:**
  - `ApprovalStatus`: `pending, accepted, rejected, expired, withdrawn`
  - `BookingPaymentStatus`: `not_due, due, processing, paid, failed, expired, voided, refund_pending, refunded, refund_failed`
  - `ReservationStatus`: `none, held, committed, released, consumed`
  - `FulfilmentStatus`: `not_started, picked_up, in_transit, out_for_delivery, delivered, pickup_refused`
- `PaymentStatus` (payment document): `created, pending, succeeded, failed, cancelled, refund_pending, refunded, refund_failed`
- `TripStatus`: `draft, published, in_progress, completed, cancelled`
- `VerificationStatus`: `not_submitted, pending, verified, rejected, suspended` (**not_submitted and suspended are new**)
- `DriverLinkStatus`: `pending, active, rejected, removed`
- `DocumentKind`: `aadhaar, pan, driving_license, rc` (**rc is new**)
- `Role`: `customer, agency, driver, admin`
- `TrackingEventType`: see A§13.1.
- `NotificationKind`: the v2 list plus A§13.2 additions.

---

## 1. Shared schemas

```python
# ── Places / addresses ──────────────────────────────────────────────
class PlaceDTO(BaseModel):                 # response
    placeId: str; name: str; formattedAddress: str
    lat: float; lng: float
    locality: str | None; district: str | None
    state: StateCode | str; stateName: str; pincode: str | None

class AddressInput(BaseModel):             # request (shipment source/destination)
    line1: str = Field(min_length=3, max_length=120)      # trimmed
    line2: str | None = Field(None, max_length=120)
    landmark: str | None = Field(None, max_length=80)
    pincode: Pincode
    state: StateCode
    source: Literal["autocomplete", "current_location", "manual"]
    placeId: PlaceId | None = None          # required when source == "autocomplete"
    location: LatLng | None = None          # required when source == "current_location" (browser geolocation, user-granted)
    # model_validator: exactly the field matching `source` must be present
    #   ("manual" → neither; server forward-geocodes the text)

class AddressDTO(BaseModel):               # response
    line1: str; line2: str | None; landmark: str | None
    pincode: str; state: StateCode; stateName: str
    districtName: str                       # = place.district ?? place.locality ?? place.name (UI compatibility)
    place: PlaceDTO
    source: Literal["autocomplete", "current_location", "manual"]

class LatLng(BaseModel): lat: Lat; lng: Lng

# ── Pricing ─────────────────────────────────────────────────────────
class AdditionalChargeInput(BaseModel):
    label: str = Field(min_length=2, max_length=40)
    amountRupees: int = Field(ge=0, le=5000)
    basis: Literal["per_booking", "special_handling_only"] = "per_booking"
# list max 5; labels unique case-insensitively; server derives `code` = slug(label)

class PricingLine(BaseModel):
    code: Literal["distance", "weight", "additional", "service_fee"]; label: str; amount: int

class PricingBreakdown(BaseModel):         # replaces PricingBreakdownV2
    pricingVersion: Literal[3]
    distanceKm: float; weightKg: int; ratePerKmPaise: int; ratePerKgPaise: int
    distanceCharge: int; weightCharge: int; transportationCharge: int
    additionalCharges: int                  # Σ applied additional lines
    handlingFee: int                        # DEPRECATED alias = additionalCharges (kept one release for the UI)
    serviceFee: int; totalPayable: int; agencyNet: int
    lines: list[PricingLine]                # Σ amount == totalPayable

# ── Booking state (attached to every booking DTO) ───────────────────
class BookingStateDTO(BaseModel):
    approvalStatus: ApprovalStatus
    paymentStatus: BookingPaymentStatus
    reservationStatus: ReservationStatus
    fulfilmentStatus: FulfilmentStatus
    closure: ClosureDTO | None              # {kind: "rejected"|"cancelled", reason, note, at, byRole}

# ── Misc ────────────────────────────────────────────────────────────
class FileRefDTO(BaseModel): fileId: str; url: str        # url = signed content URL
class FileDTO(FileRefDTO): contentType: str; sizeBytes: int; kind: str; expiresAt: datetime
class Page[T](BaseModel): items: list[T]; nextCursor: str | None
class NotificationDTO, ReviewDTO, PaymentSummaryDTO   # = TS common.ts (PaymentSummaryDTO.provider is always "cashfree")
```

### 1.1 Session user (`SessionUserDTO`, TS `auth.ts`, with deltas)

```python
class SessionUserDTO(BaseModel):
    id: str                                 # Firebase uid
    role: Role; name: str; phoneMasked: str  # "+91 ••••• •3210"
    photoUrl: str | None                    # signed URL
    agency: {id, name, verification: VerificationStatus, reason: str|None} | None   # role agency
    driver: {agencyLink: {agencyId, agencyName, status}|None, verification: VerificationStatus} | None
    claimsVersion: int                      # NEW: when it differs from the token's claim "v", client calls getIdToken(true)

class AuthResultDTO(BaseModel):            # NEW: every login/signup/reset/phone-change response
    customToken: str                        # pass to signInWithCustomToken() immediately (expires in 1 h)
    user: SessionUserDTO
```

---

## 2. Global DTO deltas vs today's TS contracts

These apply everywhere and are the only differences D1 must absorb.

1. **Places replace districts.**
   - `districtId` is removed from all requests and responses.
   - `Address` becomes `AddressDTO` (§1).
   - Agency `districtId` / `districtName` become `base: PlaceDTO`, plus `districtName` (kept, derived) and `state`.
   - Checkpoint `placeId` is now a **Google place id**, and each checkpoint carries `lat`, `lng`, `serviceRadiusKm`.
   - `RouteStopDTO.lat` / `lng` are always numbers (real geocoded coordinates).
2. **Pricing:** `PricingBreakdownV2` → `PricingBreakdown` v3. `rates.handlingFeeRupees` → `rates.additionalCharges: AdditionalChargeDTO[]`.
3. **Booking DTOs** (customer, agency and driver; list items and details) gain `state: BookingStateDTO`. `status` and `tab` stay, derived.
4. **Offers:**
   - `TripOfferDTO` gains `matchType: "exact" | "intermediate"`.
   - `pickup.distanceKm` / `drop.distanceKm` (address to checkpoint) and `distanceSource: "road" | "straight_line"` are added.
   - `availableCapacityKg` is for the customer's **segment**.
5. **Capacity:**
   - `TripCapacityDTO` fields are computed on the most-loaded leg: `bookedKg` = committed, `reservedKg` = held (unexpired), `availableKg` = `offeredKg − maxLegLoad`.
   - `AgencyTripDTO` gains `legs: TripLegDTO[]` and `route: {distanceKm, durationMin, overviewPolyline}`.
6. **Ids:**
   - User and driver ids are Firebase uids, not `usr_*`.
   - Booking ids are `TAKI` + 8 digits.
7. **Files:** every `*Url` field is a signed absolute URL (60 min), not `/api/files/{id}`. Photo arrays are `{fileId, url}`.
8. **Payments:**
   - `provider` is `"cashfree"` and `checkout.kind` is `"cashfree"`, except when the owner-approved dev test gateway is enabled (PAYMENT_PROVIDER=dev, APP_ENV development/test only): then `provider` is `"dev"` and `checkout` is `{kind: "dev", mode: "test", label: "Test payment", url, devToken}`, and responses carry `testPayment: true`.
   - Every `dev` member is removed.
   - `PaymentStatusResponse` gains `bookingState: BookingStateDTO`.
9. **Verification:** `VerificationStatus` adds `not_submitted` and `suspended`. `AdminVerificationDTO.submittedAt` stays nullable.
10. **Auth:** `OtpChallengeDTO`, `OtpVerifyResultDTO` and `proofToken` are removed (Firebase phone auth). Signup, login and reset return `AuthResultDTO`.

---

## 3. Health and meta

| # | Method & path | Role | Request | 2xx response | Errors | Replaces |
|---|---|---|---|---|---|---|
| E1 | `GET /health` | public | — | `{ok: true, version: str, env: str}`; `Cache-Control: no-store` | — | `GET /api/health` |
| E2 | `GET /health/ready` | public | — | `{ok, firestore: "ok"\|"error", auth: "emulator"\|"live", payments: "configured"\|"not_configured", maps: "configured"\|"not_configured"}`. 503 when Firestore is unreachable. | `database_unavailable` | `GET /api/health` (readiness part) |
| E3 | `GET /meta` | public | — | `{states: [{code, name}], goodsCategories, packageTypes, specialHandling, vehicleClasses, bodyTypes, vehicleCountRanges, limits: {weightKg:{min,max}, bookingWindowDays: 60, maxCheckpoints: 10, serviceRadiusKm:{min:2,max:15,default:10}, ratePerKmPaise:{min,max}, ratePerKgPaise:{min,max}, maxAdditionalCharges: 5}, features: {paymentsConfigured: bool, mapsConfigured: bool, requireDeliveryProof: bool}}`. `Cache-Control: public, max-age=300` | — | `GET /api/geo/districts` (districts are replaced by Places; states are listed here) |

---

## 4. Auth, session, profile (D2)

### 4.1 Request bodies

```python
class PhoneStatusResponse(BaseModel):
    phone: str                              # E.164 from the P token
    phoneMasked: str
    registered: bool
    role: Role | None                       # when registered
    invite: {inviteId: str, agencyName: str, fullName: str} | None   # pending driver invite for this phone

class CustomerSignupBody(BaseModel):
    fullName: Name(60); dob: Dob; acceptTerms: Literal[True]
    password: Password; confirmPassword: str

class AgencySignupBody(BaseModel):
    ownerName: Name(60); agencyName: Name(80)
    base: PlaceInput                        # {placeId} of the agency's city/district (Places Autocomplete, types=(cities))
    vehicleCountRange: VehicleCountRange
    statesCovered: list[StateCode] = Field(min_length=1, max_length=5)   # unique
    acceptTerms: Literal[True]; password: Password; confirmPassword: str

class DriverSignupBody(BaseModel):
    fullName: Name(60)
    agencyId: AgencyId | None = None        # request path (verified agency from GET /public/agencies)
    inviteId: InviteId | None = None        # invite path (from PhoneStatusResponse.invite)
    acceptTerms: Literal[True]; password: Password; confirmPassword: str
    # validator: exactly one of agencyId / inviteId  → fields.agencyId "Choose your agency"

class PlaceInput(BaseModel): placeId: PlaceId

class LoginBody(BaseModel):
    role: Role                              # "admin" only from the hidden admin login page
    phone: Phone; password: str = Field(min_length=1, max_length=64)

class ResetPasswordBody(BaseModel): password: Password; confirmPassword: str
class ChangePasswordBody(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=64); password: Password; confirmPassword: str
    # validator: password != currentPassword → fields.password "Choose a password you haven't used here"
class ChangePhoneBody(BaseModel): currentPassword: str = Field(min_length=1, max_length=64)   # + X-Phone-Proof header
class LogoutBody(BaseModel): allDevices: bool = False

class CustomerProfilePatch(BaseModel): fullName: Name(60)
class AgencyProfilePatch(BaseModel):
    ownerName: Name(60); agencyName: Name(80); base: PlaceInput
    statesCovered: list[StateCode] (1..5); vehicleCountRange: VehicleCountRange
class DriverProfilePatch(BaseModel): fullName: Name(80)

# ⓜ PUT /me/documents/{kind}: fields  number: str (8..24; validated per kind), validUntil: IsoDate | None (DL required for verification),
#    files  file (required), backFile (optional; Aadhaar/DL back side)
# ⓜ PUT /me/photo: file `photo` (JPEG/PNG/WEBP ≤ 5 MB)
```

### 4.2 Endpoints

| # | Method & path | Role | Request | 2xx response | Errors | Replaces |
|---|---|---|---|---|---|---|
| E4 | `POST /auth/phone/status` | **P** | — | 200 `PhoneStatusResponse` | 401 `phone_proof_required`; 429 | `POST /api/auth/otp/send`, `/otp/resend`, `/otp/verify` (OTP now via the Firebase JS SDK + reCAPTCHA) |
| E5 | `POST /auth/signup/customer` | **P** | `CustomerSignupBody` | 201 `AuthResultDTO` | 409 `account_exists`; 422 `underage`; 401 `phone_proof_required` | `POST /api/auth/signup/customer` |
| E6 | `POST /auth/signup/agency` | **P** | `AgencySignupBody` | 201 `AuthResultDTO` (agency `verification.status = not_submitted`) | 409 `account_exists`; 422 `address_not_found`, `outside_service_area`; 503 `maps_not_configured` | `POST /api/auth/signup/agency` |
| E7 | `POST /auth/signup/driver` | **P** | `DriverSignupBody` | 201 `AuthResultDTO`. Invite path: link `active`, invite `accepted`. Request path: link `pending`, agency notified `driver_link_requested`. | 409 `account_exists`; 404 `not_found` (agency not verified, or invite not pending / not for this phone) | `POST /api/auth/signup/driver` |
| E8 | `POST /auth/login` | public | `LoginBody` | 200 `AuthResultDTO` | 401 `invalid_credentials`; 423 `account_locked` (`details.lockedUntil`); 403 `wrong_role` (`details.role`), `account_disabled`; 429 | `POST /api/auth/login` |
| E9 | `POST /auth/password/reset` | **P** | `ResetPasswordBody` | 200 `AuthResultDTO` (all other sessions revoked; lockout cleared) | 404 `account_not_found`; 401 `phone_proof_required` | `POST /api/auth/password/reset` |
| E10 | `POST /auth/logout` | any | `LogoutBody` | 204. `allDevices: true` revokes every session (`sessionsValidAfter = now` + `revoke_refresh_tokens`). The client always calls `signOut()`. | — | `POST /api/auth/logout` |
| E11 | `GET /auth/session` | public | — | 200 `{user: SessionUserDTO \| null}`. Uses `check_revoked=True`. An invalid or absent token gives `user: null`, never 401. | — | `GET /api/auth/session` |
| E12 | `GET /me` | any | — | 200 `SessionUserDTO` | — | `GET /api/me` |
| E13 | `GET /me/profile` | any | — | 200 `ProfileDTO` (TS union `CustomerProfileDTO \| AgencyProfileDTO \| DriverProfileDTO \| AdminProfileDTO`, with §2 deltas; `AgencyProfileDTO` has `base: PlaceDTO`, `districtName`, `state`) | — | `GET /api/me/profile` |
| E14 | `PATCH /me/profile` | customer, agency, driver | Role-specific patch (§4.1). A body that does not match the caller's role → 400. | 200 `ProfileDTO`. Name changes fan out to denormalised fields (A§6.5). | 422 `address_not_found`, `outside_service_area` (agency base) | `PATCH /api/me/profile` |
| E15 | `POST /me/password` | any | `ChangePasswordBody` | 200 `AuthResultDTO` (this device re-signs in; other devices are revoked) | 401 `invalid_credentials` (counts toward lockout); 423 `account_locked` | `POST /api/me/password` |
| E16 | `POST /me/phone` | customer, agency, driver | `ChangePhoneBody` + header `X-Phone-Proof` (P token for the **new** phone) | 200 `AuthResultDTO`. The temporary Auth user is deleted, the Auth phone updated, `phoneIndex` moved, other sessions revoked. | 401 `invalid_credentials`, `phone_proof_required`; 409 `phone_taken` | `POST /api/me/phone`, `POST /api/auth/otp/send-phone-change` |
| E17 | `PUT /me/photo` ⓜ | customer, agency, driver | file `photo` | 200 `{photoUrl: str, file: FileRefDTO}`. Agency or driver: may move verification `not_submitted` → `pending` when the set is complete. | 413 `file_too_large`; 422 `file_invalid` | `PUT /api/me/photo` |
| E18 | `PUT /me/documents/{kind}` ⓜ | agency (`aadhaar\|pan\|driving_license`, one identity document; a new kind replaces the old one), driver (`driving_license\|aadhaar`) | fields `number`, `validUntil?`; files `file`, `backFile?` | 200 `DocumentUploadResultDTO` `{document: DocumentDTO, verification: VerificationStatus}` | 422 `invalid_document_number`, `file_invalid`; 409 `already_verified`; 403 `forbidden` (kind not allowed for the role) | `PUT /api/me/documents/[kind]` |

**`DocumentDTO`** (TS) keeps `kind, label, numberMasked, fileUrl, backFileUrl, status ("missing"|"pending"|"verified"|"rejected"), uploadedAt`, and adds `validUntil: IsoDate | null`.

---

## 5. Public (D2)

| # | Method & path | Role | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|---|
| E19 | `GET /public/agencies` | public | `q?` (trim, ≤ 60), `near?` = `lat,lng` (sorts by distance from `base`), `limit` 1–20 (default 20) | 200 bounded `{items: [{id, agencyName, districtName, state}]}`. **Verified agencies only.** | — | `GET /api/public/agencies` (the `districtId` filter is replaced by `near`) |
| E20 | `POST /public/contact` | public | `ContactBody` (TS `common.ts`: `name` 2–80, `phone?` Phone or `""`, `email?` ≤ 120 or `""`, `role` enum default `other`, `message` 10–2000, `website` honeypot ≤ 200; at least one of `phone` / `email`) | 201 `{id: "msg_…", receivedAt}`. A filled honeypot gives 201 with nothing stored. | 429 (5/h/IP) | `POST /api/public/contact` |

---

## 6. Files (D2)

| # | Method & path | Role | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|---|
| E21 | `GET /files/{fileId}` | any | — | 200 `FileDTO` with a fresh signed `url`, after `can_read(viewer, file)` (A§12.2) | 404 (missing **or** not readable) | `GET /api/files/[fileId]` (authorisation part) |
| E22 | `GET /files/{fileId}/content` | **signed URL** (no Bearer) | query `exp` (unix seconds), `v` (viewer uid), `sig` (base64url HMAC) | 200 file bytes. `Content-Type` from metadata, `Cache-Control: private, max-age=300`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` | 403 `forbidden` (bad or expired signature); 404 (deleted) | `GET /api/files/[fileId]` (streaming part) |

Uploads have no generic endpoint. Each upload goes through its business endpoint (E17, E18, E57, E59, E98), which validates magic bytes and stores the file through the Admin SDK.

---

## 7. Maps (D5)

```python
class GeocodeBody(BaseModel):
    placeId: PlaceId | None = None
    address: str | None = Field(None, min_length=5, max_length=300)   # free text; country=IN is forced
    # validator: exactly one of placeId / address
class ReverseGeocodeBody(BaseModel): lat: Lat; lng: Lng              # browser geolocation (user-granted); never stored here
```

| # | Method & path | Role | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|---|
| E23 | `POST /maps/geocode` | any | `GeocodeBody` | 200 `{place: PlaceDTO, inServiceArea: bool}` (cached 30 days) | 422 `address_not_found`; 503 `maps_not_configured`; 502 `maps_unavailable`; 429 | — (new; used by forms for previews and validation) |
| E24 | `POST /maps/reverse-geocode` | any | `ReverseGeocodeBody` | 200 `{place: PlaceDTO, inServiceArea: bool}`. Use it to prefill the address form for "current location". | 422 `address_not_found`; 503; 502; 429 | `GET /api/geo/nearest-district` |

Places **Autocomplete** runs in the browser with the restricted browser key; there is no proxy. Route preview for agencies is E70.

---

## 8. Customer (D4)

### 8.1 Request schemas

```python
class ShipmentPackageInput(BaseModel):
    weightKg: WeightKg; goodsCategory: GoodsCategory; packageType: PackageType
    description: str = Field(min_length=3, max_length=300)
    pieces: Pieces = 1
    specialHandling: list[SpecialHandling] = Field(default_factory=list, max_length=4)   # unique
    declaredValueRupees: int | None = Field(None, ge=0, le=10_000_000)
    prohibitedItemsDeclaration: Literal[True]      # "Confirm that the shipment has no prohibited items"

class CreateShipmentBody(BaseModel):
    source: AddressInput; destination: AddressInput
    receiver: {name: Name(60), phone: Phone}
    package: ShipmentPackageInput
    shippingDate: ShippingDate
    # server: geocode both (A§9.1); 422 address_not_found / address_state_mismatch / outside_service_area;
    # haversine(source, destination) < 1 km → 400 invalid_request fields.destination "Source and destination are the same place"
    # receiver.phone may equal the customer's phone (allowed)
UpdateShipmentBody = CreateShipmentBody            # full replace; only while status == open and no booking

class OfferFiltersQuery(BaseModel):
    sort: Literal["price_asc","price_desc","departure_asc","arrival_asc"] = "price_asc"
    vehicleClass: list[VehicleClass] | None        # repeated or comma-separated
    minPrice: int | None = Field(None, ge=0); maxPrice: int | None = Field(None, gt=0)
    minCapacityKg: int | None = Field(None, gt=0)
    date: IsoDate | None                           # "try another date" (IST); default = shipment.shippingDate

class GuestSearchQuery(OfferFiltersQuery):
    fromPlaceId: PlaceId; toPlaceId: PlaceId        # replaces from/to districtIds
    weightKg: WeightKg; goods: GoodsCategory = "general_goods"
    handling: list[SpecialHandling] | None
    date: IsoDate                                   # required for guests (today..+60)

class TripDetailsQuery(BaseModel):                  # either shipmentId (signed-in) or the guest fields
    shipmentId: ShipmentId | None
    fromPlaceId: PlaceId | None; toPlaceId: PlaceId | None
    weightKg: WeightKg | None; goods: GoodsCategory | None; handling: list[SpecialHandling] | None

class RequestBookingBody(BaseModel): shipmentId: ShipmentId; tripId: TripId      # + Idempotency-Key 🔑
class CancelBookingBody(BaseModel): reason: str | None = Field(None, max_length=300)
class ReviewBody(BaseModel): rating: int = Field(ge=1, le=5); comment: str | None = Field(None, max_length=500)
class RegenerateOtpBody(BaseModel): which: Literal["pickup","delivery"]
class ShipmentsQuery(CursorQuery): tab: CustomerTab | None   # no tab → open shipments without a booking
class BookingsQuery(CursorQuery): tab: CustomerTab | None; active: bool = False   # active → statuses not terminal
```

### 8.2 Responses (TS `customer.ts` + §2 deltas)

- `ShipmentDTO`: `source` / `destination` are `AddressDTO`. Adds `directDistanceKm: float`. `status` is extended to `open | requested | booked | in_transit | delivered | withdrawn`.
- `TripOfferDTO`:
  - adds `matchType`, `distanceSource`;
  - `pickup` and `drop` gain `distanceKm: float | null` and `placeId`, `lat`, `lng`;
  - `route: RouteStopDTO[]`, where `RouteStopDTO` gains `placeId`, `serviceRadiusKm` and non-null `lat` / `lng`;
  - `rates` = `{perKmPaise, perKgPaise, additionalCharges: [{label, amountRupees, basis}]}`;
  - `pricing: PricingBreakdown`.
- `TripDetailsDTO`: adds `routePolyline: str` (overview encoded polyline) and `legs: [{index, distanceKm, durationMin}]`. `problem` gains `"maps_unavailable"`, which is never fatal.
- `CustomerBookingDTO`: adds `state: BookingStateDTO`, `matchType`, `driverAssignedAt`. `otps` (decrypted) is present only when `paymentStatus == paid` and fulfilment is not `delivered` / `pickup_refused`. Contact rules follow A§12.3.
- `CustomerBookingListItem`: adds `state`.
- `TrackingDTO`: unchanged. `liveLocation` is always `null`. It adds `routePolyline` and `checkpoints: [{index, placeName, lat, lng, expectedArrivalAt, expectedDepartureAt, actualArrivalAt, actualDepartureAt, inSegment}]` for the map.
- `PaymentHistoryItem`: unchanged. `provider` is always `"cashfree"`.

### 8.3 Endpoints

| # | Method & path | Role | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|---|
| E25 | `GET /customer/dashboard` | customer | — | 200 `CustomerDashboardDTO` | — | `GET /api/customer/dashboard` |
| E26 | `POST /customer/shipments` | customer | `CreateShipmentBody` | 201 `ShipmentDTO` | 422 `past_date`, `date_too_far`, `address_not_found`, `address_state_mismatch`, `outside_service_area`; 503 `maps_not_configured`; 502 `maps_unavailable` | `POST /api/customer/shipments` |
| E27 | `GET /customer/shipments` | customer | `ShipmentsQuery` | 200 `Page[ShipmentListItem]` | — | `GET /api/customer/shipments` |
| E28 | `GET /customer/shipments/{shipmentId}` | customer (owner) | — | 200 `ShipmentWithBookingsDTO` | 404 | `GET /api/customer/shipments/[shipmentId]` |
| E29 | `PATCH /customer/shipments/{shipmentId}` | customer (owner) | `UpdateShipmentBody` | 200 `ShipmentDTO` | 409 `shipment_has_open_booking` (`details.bookingId`), `invalid_transition` (not open); E26's 422 codes | `PATCH /api/customer/shipments/[shipmentId]` |
| E30 | `DELETE /customer/shipments/{shipmentId}` | customer (owner) | — | 204 (status `withdrawn`) | 409 `shipment_has_open_booking`, `invalid_transition` | `DELETE /api/customer/shipments/[shipmentId]` |
| E31 | `GET /customer/shipments/{shipmentId}/offers` | customer (owner) | `OfferFiltersQuery` | 200 `OffersResponse` `{items: TripOfferDTO[] (≤ 100), excludedForCapacity, excludedForRestrictions, date}` | 404; 409 `invalid_transition` (shipment not open). Maps errors never fail the call (`distanceSource = straight_line`). | `GET /api/customer/shipments/[shipmentId]/offers` |
| E32 | `GET /customer/search` | public | `GuestSearchQuery` | 200 `OffersResponse`. Pricing is shown, and driver and agency details are as for a signed-in customer before booking. | 422 `address_not_found`, `outside_service_area`, `past_date`, `date_too_far`; 503 `maps_not_configured`; 429 (search per IP) | `GET /api/customer/search` |
| E33 | `GET /customer/trips/{tripId}` | public | `TripDetailsQuery` | 200 `TripDetailsDTO`. `existingBookingId` is set when the signed-in caller's shipment already has an open booking. | 404 (trip not published / visible) | `GET /api/customer/trips/[tripId]` |
| E34 | `POST /customer/bookings` 🔑 | customer | `RequestBookingBody` | 201 `CustomerBookingDTO` (`state.approvalStatus = pending`); 200 on an idempotent replay | 409 `shipment_has_open_booking` (`details.bookingId`), `trip_not_bookable`, `insufficient_capacity`; 422 `not_on_route`, `goods_not_accepted`, `handling_not_supported`, `package_too_heavy`, `departed`, `idempotency_key_reused`; 400 `idempotency_key_required`; 429 | `POST /api/customer/bookings` |
| E35 | `GET /customer/bookings` | customer | `BookingsQuery` | 200 `Page[CustomerBookingListItem]` | — | `GET /api/customer/bookings` |
| E36 | `GET /customer/bookings/counts` | customer | — | 200 `Record<CustomerTab, int>` (aggregate `count()` per tab) | — | `GET /api/customer/bookings/counts` |
| E37 | `GET /customer/bookings/{bookingId}` | customer (owner) | — | 200 `CustomerBookingDTO`. Lazy expiry is applied first. | 404 | `GET /api/customer/bookings/[bookingId]` |
| E38 | `POST /customer/bookings/{bookingId}/cancel` | customer (owner) | `CancelBookingBody` | 200 `CustomerBookingDTO` (closure cancelled / `customer_cancelled`; capacity released; refund queued if paid) | 409 `invalid_transition` (picked up or later, or already closed) | `POST /api/customer/bookings/[bookingId]/cancel` |
| E39 | `POST /customer/bookings/{bookingId}/otp/regenerate` | customer (owner) | `RegenerateOtpBody` | 200 `{otps: CustomerBookingDTO.otps}` (new code, attempts reset) | 409 `otp_not_exhausted` (fewer than 5 failed attempts), `invalid_transition` (code already used or booking not paid) | `POST /api/customer/bookings/[bookingId]/otp/regenerate` |
| E40 | `GET /customer/bookings/{bookingId}/tracking` | customer (owner) | — | 200 `TrackingDTO` | 404 | `GET /api/customer/bookings/[bookingId]/tracking` |
| E41 | `POST /customer/bookings/{bookingId}/review` | customer (owner) | `ReviewBody` | 201 `ReviewDTO` | 409 `already_reviewed`, `invalid_transition` (not delivered) | `POST /api/customer/bookings/[bookingId]/review` |

---

## 9. Payments (D5)

```python
class CreatePaymentOrderBody(BaseModel): bookingId: BookingId          # + Idempotency-Key 🔑

class CreatePaymentOrderResponse(BaseModel):            # TS payments.ts, dev members removed
    paymentId: str; provider: Literal["cashfree"]; amountRupees: int; expiresAt: datetime
    checkout: {kind: Literal["cashfree"], mode: Literal["sandbox","production"], paymentSessionId: str, orderId: str}
    reused: bool

class PaymentStatusResponse(BaseModel):                  # TS + bookingState
    paymentId: str; bookingId: str; status: PaymentStatus; bookingStatus: BookingStatus
    bookingState: BookingStateDTO
    amountRupees: int; provider: Literal["cashfree"]; methodLabel: str | None; failureReason: str | None
    refund: {status: "pending"|"succeeded"|"failed", amountRupees: int, completedAt: datetime | None} | None
```

| # | Method & path | Role | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|---|
| E42 | `POST /payments/orders` 🔑 | customer (booking owner) | `CreatePaymentOrderBody` | 201 `CreatePaymentOrderResponse` (200 with `reused: true` when an open, unexpired order exists). Flow in A§10.2. | 501 `payments_not_configured`; 409 `already_paid`, `invalid_transition` (not accepted, or closed); 410 `payment_window_closed`; 502 `gateway_error`; 422 `idempotency_key_reused`; 400 `idempotency_key_required`; 429 | `POST /api/payments/orders`, `POST /api/payments/cashfree/order` |
| E43 | `GET /payments/{paymentId}` | customer (owner) | — | 200 `PaymentStatusResponse` (**read-only**; no gateway call) | 404 | `GET /api/payments/[paymentId]` (read part) |
| E44 | `POST /payments/{paymentId}/verify` | customer (owner) | — | 200 `PaymentStatusResponse` after a server-side `GET /orders/{id}` and `confirm_payment(source = "verify")`. Used by the return page. | 501 `payments_not_configured`; 502 `gateway_error` (the stored status is still returned in `details`); 404; 429 | `GET /api/payments/cashfree/verify`, `GET /api/payments/[paymentId]` (verify-on-read part) |
| E45 | `POST /payments/cashfree/webhook` | system (Cashfree signature) | Raw JSON. Headers `x-webhook-signature`, `x-webhook-timestamp`, `x-webhook-version`. | 200 `{ok: true, outcome: "applied"\|"duplicate"\|"ignored"}` | 401 `invalid_signature`, `stale_timestamp`; 501 `webhook_not_configured`; 500 (Cashfree retries) | `POST /api/payments/cashfree/webhook` (**the URL path changes**: update `notify_url`; nothing in the dashboard is hard-coded because `notify_url` is sent per order) |
| E46 | `GET /payments/history` | customer | `CursorQuery` | 200 `Page[PaymentHistoryItem]` (every attempt, newest first) | — | `GET /api/customer/payments` |

**Dev test gateway (owner decision, kept):** `POST /api/v1/payments/dev/confirm` and the "Test payment" page exist ONLY when PAYMENT_PROVIDER=dev and APP_ENV is development or test; the app refuses to start with it in staging/production, and the endpoint answers 404 otherwise. It goes through the same confirmation path as Cashfree. Production payments are Cashfree only; automated tests also use the injected `FakeCashfree` (A§15.4).

**Frontend checkout (D1):**
1. `const cf = await load({ mode: checkout.mode })` (`@cashfreepayments/cashfree-js`)
2. `cf.checkout({ paymentSessionId, redirectTarget: "_self" })`
3. The return page `/customer/payment/return?paymentId=` calls E44, then polls E43 every 3 s for up to 60 s.
4. It shows success **only** when `status == "succeeded"` and `bookingState.paymentStatus == "paid"`.

---

## 10. Agency (D3; bookings E80–E83 are D4)

All `/agency/**` endpoints need role `agency`. They are scoped to `user.agencyId`, and other agencies' resources return 404.

**Verification gates:**
- `suspended` → 403 `agency_suspended` on every mutating endpoint except profile and verification.
- Publishing and accepting bookings need `verified` (403 `agency_not_verified`).
- Drafts, vehicles, drivers and invites are allowed while `not_submitted`, `pending` or `rejected`.

### 10.1 Request schemas

```python
class VehicleBody(BaseModel):                       # = TS VehicleBody
    vehicleClass: VehicleClass; modelId: VehicleModelId | None = None
    makeModel: str = Field(min_length=2, max_length=60)
    registrationNumber: Registration
    maxPayloadKg: int = Field(ge=100, le=40_000)
    bodyType: BodyType
    dimensionsFt: {length: float (0,60], width: float (0,12], height: float (0,15]} | None = None
    acceptedGoods: list[GoodsCategory] = Field(min_length=1)
    handlingSupported: list[SpecialHandling] = []
class VehiclePatchBody(VehicleBody, all optional): status: Literal["active","inactive"] | None
class VehicleListQuery: status: Literal["active","inactive","all"] = "all"
# ⓜ PUT /agency/vehicles/{id}/documents/rc: file `file` (req), `backFile` (opt), field validUntil: IsoDate | None
#   (the RC number is the vehicle's registration number; it is not re-entered)

class DriverInviteBody(BaseModel): fullName: Name(60); phone: Phone
class DriverPatchBody(BaseModel): availability: Literal["available","unavailable"]
class DriverRejectBody(BaseModel): reason: str | None = Field(None, max_length=300)
class DriverListQuery: status: Literal["active","pending","removed"] = "active"

class CheckpointInput(BaseModel):
    placeId: PlaceId                                 # Google place id (Places Autocomplete, cities/localities)
    serviceRadiusKm: float = Field(10, ge=2, le=15)  # pickup/drop catchment around this stop
    expectedArrivalAt: IsoDateTime | None            # None only for index 0
    expectedDepartureAt: IsoDateTime | None          # None only for the last stop
class TripBody(BaseModel):
    vehicleId: VehicleId; driverId: Uid
    offeredKg: int = Field(ge=100, le=40_000)        # ≤ vehicle.maxPayloadKg → 422 capacity_exceeds_vehicle
    checkpoints: list[CheckpointInput] = Field(min_length=2, max_length=10)
    acceptedGoods: list[GoodsCategory] = Field(min_length=1)
    handlingSupported: list[SpecialHandling] = []
    maxPackageKg: int | None = Field(None, gt=0, le=40_000)
    goodsNotes: str | None = Field(None, max_length=300)        # restrictions in words ("no liquids")
    ratePerKmPaise: int | None = Field(None, ge=100, le=10_000) # required when publish=true
    ratePerKgPaise: int | None = Field(None, ge=0, le=2_000)    # required when publish=true
    additionalCharges: list[AdditionalChargeInput] = Field(default_factory=list, max_length=5)
    publish: bool = False
    # validators (port of trip-rules.checkpointIssues): index 0 has departure only; last has arrival only;
    # every middle stop has both with departure ≥ arrival; arrival(i) > departure(i−1); consecutive placeIds differ;
    # field paths "checkpoints.{i}.expectedArrivalAt" etc.
class TripPatchBody(TripBody, all optional, no defaults, no publish)
class TripPreviewBody(BaseModel):
    checkpoints: list[{placeId: PlaceId}] (2..10)
    departureAt: IsoDateTime | None                  # when given, suggested times are returned
    dwellMinutes: int = Field(15, ge=0, le=240)
    ratePerKmPaise: int = Field(0, ge=0, le=10_000); ratePerKgPaise: int = Field(0, ge=0, le=2_000)
    sampleWeightKg: int = Field(500, ge=1, le=40_000)
class TripListQuery(CursorQuery): tab: Literal["upcoming","active","completed","cancelled","drafts"] = "upcoming"
class TripFormOptionsQuery: departureAt: IsoDateTime | None; arrivalAt: IsoDateTime | None; excludeTripId: TripId | None
class CancelTripBody(BaseModel): reason: Reason
class ReassignBody(BaseModel): driverId: Uid | None = None; vehicleId: VehicleId | None = None   # at least one

class AgencyBookingListQuery(CursorQuery): tab: AgencyBookingTab = "pending"; tripId: TripId | None
class RejectBookingBody(BaseModel): reason: Reason
class HistoryQuery(CursorQuery):
    q: str | None = Field(None, max_length=60)
    type: Literal["bookings","trips","vehicles","drivers","customers"] = "bookings"
    from_: IsoDate | None = Field(None, alias="from"); to: IsoDate | None
class EarningsQuery: from_: IsoDate | None (alias "from"); to: IsoDate | None
```

### 10.2 Response deltas (TS `agency.ts` + §2)

- `VehicleDTO`: `photos: FileRefDTO[]`. Adds `rc: DocumentDTO | null` and `rcVerification: {status, reason, reviewedAt}`.
- `TripCheckpointDTO`: `{index, placeId, placeName, district, districtName, state, lat, lng, serviceRadiusKm, kmFromOrigin, expected*/actual* times}`.
- `AgencyTripListItem` / `AgencyTripDTO`:
  - `rates` = `{perKmPaise, perKgPaise, additionalCharges}`;
  - `capacity: TripCapacityDTO` (leg-based);
  - `counts` adds `committed`;
  - the detail view adds `legs: [{index, fromName, toName, distanceKm, durationMin, loadKg, availableKg}]`, `route: {distanceKm, durationMin, overviewPolyline}` and `searchable: bool` (has search keys);
  - `publishBlockers: string[]` includes the new reasons "Vehicle RC missing", "Driver documents not verified", "Agency not verified" and "Maps not configured".
- `TripPreviewDTO`: `{checkpoints: [{placeId, placeName, district, state, lat, lng, kmFromOrigin, legDistanceKm, legDurationMin, suggestedArrivalAt, suggestedDepartureAt}], distanceKm, durationMins, overviewPolyline, sampleWeightKg, earningsPreview: {distanceCharge, weightCharge, additionalCharges, earnings}}`. The v2 `computedKm` / override fields are removed.
- `TripFormDriverOption`: adds `verification: VerificationStatus` and `linkStatus`. `TripFormVehicleOption` adds `rcStatus: "missing" | VerificationStatus`.
- `AgencyBookingListItem` / `AgencyBookingDTO`:
  - add `state: BookingStateDTO` and `matchType`;
  - `pickup` / `drop` drop `districtId` and gain `district`;
  - `capacity: {availableKg, afterAcceptKg}` is computed **for the booking's segment**;
  - contact and address visibility follow A§12.3 (customer phone and full addresses from `accepted`; receiver once paid).
- `AgencyProfileDTO` (E48) = `ProfileDTO` agency + `AgencyProfileSummaryDTO`, with `base: PlaceDTO`.
- `AgencyEarningsDTO`: unchanged. `AgencyEarningRowDTO.handlingFee` is renamed `additionalCharges`; `handlingFee` is kept as an alias for one release.

### 10.3 Endpoints

| # | Method & path | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|
| E47 | `GET /agency/dashboard` | — | 200 `AgencyDashboardDTO` | — | `GET /api/agency/dashboard` |
| E48 | `GET /agency/profile` | — | 200 `AgencyProfileDTO & AgencyProfileSummaryDTO` | — | `GET /api/agency/profile` |
| E49 | `PATCH /agency/profile` | `AgencyProfilePatch` (§4.1) | 200 as E48. `agencyName` is fanned out (A§6.5). | 422 `address_not_found`, `outside_service_area` | `PATCH /api/agency/profile` |
| E50 | `GET /agency/verification` | — | 200 `{status, reason, submittedAt, reviewedAt, requirements: [{key: "photo"\|"identity_document", done: bool}]}` | — | — (new; the UI previously read the profile) |
| E51 | `POST /agency/verification` | `{}` | 200 as E48. Submits or resubmits: `not_submitted` / `rejected` → `pending` once the requirements are met. Documents are uploaded first with E17 / E18. | 409 `invalid_transition` (requirements missing → `details.missing`), `already_verified` | `POST /api/agency/verification` (the multipart upload moved to E17 / E18) |
| E52 | `GET /agency/vehicles` | `VehicleListQuery` | 200 bounded `{items: VehicleDTO[]}` (`removed` excluded) | — | `GET /api/agency/vehicles` |
| E53 | `POST /agency/vehicles` | `VehicleBody` | 201 `VehicleDTO` | 409 `registration_taken` | `POST /api/agency/vehicles` |
| E54 | `GET /agency/vehicles/{vehicleId}` | — | 200 `VehicleDTO` | 404 | `GET /api/agency/vehicles/[vehicleId]` |
| E55 | `PATCH /agency/vehicles/{vehicleId}` | `VehiclePatchBody` | 200 `VehicleDTO`. Snapshots on draft and published trips are refreshed. Lowering `maxPayloadKg` below any published trip's `offeredKg` → 409. | 409 `registration_taken`, `vehicle_has_active_trips` (deactivate, or change registration or payload while published / in-progress trips exist) | `PATCH /api/agency/vehicles/[vehicleId]` |
| E56 | `DELETE /agency/vehicles/{vehicleId}` | — | 204 (soft delete `removed`; `registrationIndex` released) | 409 `vehicle_has_active_trips` | `DELETE /api/agency/vehicles/[vehicleId]` |
| E57 | `POST /agency/vehicles/{vehicleId}/photos` ⓜ | file `photo` | 201 `VehicleDTO` (≤ 5 photos) | 409 `conflict` (already 5); 413; 422 `file_invalid` | `POST /api/agency/vehicles/[vehicleId]/photos` |
| E58 | `DELETE /agency/vehicles/{vehicleId}/photos/{fileId}` | — | 200 `VehicleDTO` | 404 | `DELETE /api/agency/vehicles/[vehicleId]/photos/[fileId]` |
| E59 | `PUT /agency/vehicles/{vehicleId}/documents/rc` ⓜ | `file`, `backFile?`, `validUntil?` | 200 `VehicleDTO` (`rcVerification.status = pending`) | 409 `already_verified`; 413; 422 `file_invalid` | — (new: RC document) |
| E60 | `GET /agency/drivers` | `DriverListQuery` | 200 bounded `{items: AgencyDriverDTO[]}`. Masked document numbers; signed file URLs (pending or active links). | — | `GET /api/agency/drivers` |
| E61 | `GET /agency/drivers/{driverId}` | — | 200 `AgencyDriverDetailDTO` | 404 (not linked: pending, active or removed with history) | `GET /api/agency/drivers/[driverId]` |
| E62 | `PATCH /agency/drivers/{driverId}` | `DriverPatchBody` | 200 `AgencyDriverDTO` | 409 `driver_has_active_trips` (setting `unavailable` while published or in-progress trips exist) | `PATCH /api/agency/drivers/[driverId]` |
| E63 | `POST /agency/drivers/{driverId}/approve` | — | 200 `AgencyDriverDTO` (link `pending` → `active`; driver notified) | 409 `invalid_transition` (not pending) | `POST /api/agency/drivers/[driverId]/approve` |
| E64 | `POST /agency/drivers/{driverId}/reject` | `DriverRejectBody` | 200 `AgencyDriverDTO` (link → `rejected`) | 409 `invalid_transition` | `POST /api/agency/drivers/[driverId]/reject` |
| E65 | `DELETE /agency/drivers/{driverId}` | — | 204 (link → `removed`) | 409 `driver_has_active_trips` | `DELETE /api/agency/drivers/[driverId]` |
| E66 | `GET /agency/driver-invites` | — | 200 bounded `{items: InviteDTO[]}` | — | `GET /api/agency/driver-invites` |
| E67 | `POST /agency/driver-invites` | `DriverInviteBody` | 201 `InviteDTO` (14-day expiry; **no SMS**: the agency tells the driver) | 409 `already_exists` (pending invite for that phone), `phone_taken` (phone belongs to a non-driver account, or a driver already actively linked) | `POST /api/agency/driver-invites` |
| E68 | `DELETE /agency/driver-invites/{inviteId}` | — | 204 (→ `revoked`) | 409 `invalid_transition` (not pending) | `DELETE /api/agency/driver-invites/[inviteId]` |
| E69 | `GET /agency/trips/form-options` | `TripFormOptionsQuery` | 200 `TripFormOptionsDTO` (vehicles and drivers with `busy` overlaps for the window, verification, RC status) | — | `GET /api/agency/trips/form-options` |
| E70 | `POST /agency/trips/preview` | `TripPreviewBody` | 200 `TripPreviewDTO` (Routes `computeRoutes`) | 422 `address_not_found`, `outside_service_area`, `invalid_checkpoints`; 503 `maps_not_configured`; 502 `maps_unavailable` | `POST /api/agency/trips/preview` |
| E71 | `GET /agency/trips` | `TripListQuery` | 200 `TripListResponse` `{items, nextCursor, counts}` | — | `GET /api/agency/trips` |
| E72 | `POST /agency/trips` | `TripBody` | 201 `AgencyTripDTO`. `publish: true` creates the draft and then runs publish **in one request**; if publish fails, the draft is kept and the error is returned with `details.tripId`. | 403 `agency_not_verified`, `agency_suspended`; 409 `driver_schedule_conflict` / `vehicle_schedule_conflict` (`details.conflictingTripId`), `driver_unavailable`, `driver_not_verified`, `vehicle_unavailable`, `vehicle_documents_missing`; 422 `invalid_checkpoints`, `capacity_exceeds_vehicle`, `date_too_far`, `address_not_found`, `outside_service_area`; 503 / 502 maps | `POST /api/agency/trips` |
| E73 | `GET /agency/trips/{tripId}` | — | 200 `AgencyTripDTO` (with `bookings[]`, legs, capacity) | 404 | `GET /api/agency/trips/[tripId]` |
| E74 | `PATCH /agency/trips/{tripId}` | `TripPatchBody` | 200 `AgencyTripDTO`. Drafts: any field (stops recomputed). Published: only rates, additional charges, `maxPackageKg`, `goodsNotes`, and `offeredKg` (≥ max leg load and ≤ vehicle). Rates apply to new requests and are re-locked at accept. | 409 `trip_has_bookings`, `invalid_transition` (in progress or closed); 422 `capacity_below_booked`, `capacity_exceeds_vehicle`, `invalid_checkpoints` | `PATCH /api/agency/trips/[tripId]` |
| E75 | `DELETE /agency/trips/{tripId}` | — | 204 (**drafts only**; hard delete) | 409 `invalid_transition` | `DELETE /api/agency/trips/[tripId]` |
| E76 | `POST /agency/trips/{tripId}/publish` | — | 200 `AgencyTripDTO` (`published`; search keys and schedule intervals written) | Same as E72's publish errors | `POST /api/agency/trips/[tripId]/publish` |
| E77 | `POST /agency/trips/{tripId}/unpublish` | — | 200 `AgencyTripDTO` (→ `draft`) | 409 `trip_has_bookings` | `POST /api/agency/trips/[tripId]/unpublish` |
| E78 | `POST /agency/trips/{tripId}/cancel` | `CancelTripBody` | 200 `AgencyTripDTO` (cascade A§7.5; refunds queued; everyone notified) | 409 `invalid_transition` (a booking is picked up or later, or the trip is completed) | `POST /api/agency/trips/[tripId]/cancel` |
| E79 | `POST /agency/trips/{tripId}/reassign` | `ReassignBody` | 200 `AgencyTripDTO` (bookings' `driverId` / `vehicleId` fanned out; old and new driver and paid customers notified) | 409 `driver_schedule_conflict`, `vehicle_schedule_conflict`, `driver_unavailable`, `driver_not_verified`, `vehicle_documents_missing`, `invalid_transition` (picked-up bookings exist); 422 `capacity_exceeds_vehicle` (new vehicle smaller than the max leg load) | `POST /api/agency/trips/[tripId]/reassign` |
| E80 | `GET /agency/bookings` | `AgencyBookingListQuery` | 200 `BookingListResponse` `{items, nextCursor, counts: Record<AgencyBookingTab,int>}` | — | `GET /api/agency/bookings` |
| E81 | `GET /agency/bookings/{bookingId}` | — | 200 `AgencyBookingDTO` (timeline = booking events, with remarks and proof URLs) | 404 | `GET /api/agency/bookings/[bookingId]` |
| E82 | `POST /agency/bookings/{bookingId}/accept` | `{}` | 200 `AgencyBookingDTO` (approval `accepted`, payment `due`, reservation `held`, `paymentDueAt` set; customer notified with driver and vehicle) | 403 `agency_not_verified`, `agency_suspended`; 409 `insufficient_capacity` (`details.availableKg`), `invalid_transition`, `trip_not_bookable`; 410 `request_expired` | `POST /api/agency/bookings/[bookingId]/accept` |
| E83 | `POST /agency/bookings/{bookingId}/reject` | `RejectBookingBody` | 200 `AgencyBookingDTO` (approval `rejected`; shipment back to `open`; customer notified) | 409 `invalid_transition` (only pending requests) | `POST /api/agency/bookings/[bookingId]/reject` |
| E84 | `GET /agency/history` | `HistoryQuery` | 200 `Page[HistoryRow]`. Bookings use `searchTokens` (first token indexed, the rest filtered in memory); trips, vehicles, drivers and customers are agency-scoped. | — | `GET /api/agency/history` |
| E85 | `GET /agency/earnings` | `EarningsQuery` | 200 `AgencyEarningsDTO` (built from real `earnings`, `payments` and `settlements` only) | — | `GET /api/agency/earnings` |

---

## 11. Driver app (D4; profile and agency link E101–E103 are D3)

- Role `driver` throughout.
- Trip and shipment endpoints need an **active agency link** (403 `driver_not_linked`).
- A driver sees only trips where `trip.driverId == uid` (never drafts) and bookings where `driverId == uid` with `paymentStatus == paid` (A§12.3). Everything else returns 404.
- **No location fields are accepted on any driver endpoint.** Positions are never collected or fabricated.

### 11.1 Request schemas (unchanged from TS `driver.ts` unless marked)

```python
class CheckpointActionBody(BaseModel): remarks: Remarks; clientAt: IsoDateTime | None
class PickupBody(BaseModel): otp: OtpCode; remarks: Remarks; clientAt: IsoDateTime | None
class RefusePickupBody(BaseModel): reason: str = Field(min_length=5, max_length=300)
# ⓜ deliver: fields otp: OtpCode, receivedBy: str ≤ 80 | None, remarks: Remarks, clientAt: IsoDateTime | None
#            files proof: 0..3 images (JPEG/PNG/WEBP ≤ 8 MB each; ≥ 1 when REQUIRE_DELIVERY_PROOF=true)
class RemarkBody(BaseModel): text: str = Field(min_length=1, max_length=300)
class DriverShipmentsQuery(CursorQuery): tab: DriverShipmentTab = "pending_pickup"
class DriverTripsQuery: status: Literal["upcoming","active","completed"] = "upcoming"
class DriverHistoryQuery(CursorQuery): q: str | None (≤ 20, booking id, case-insensitive); month: str | None (^\d{4}-(0[1-9]|1[0-2])$, IST)
class DriverProfilePatchBody(BaseModel): fullName: Name(80)
class AgencyLinkBody(BaseModel): agencyId: AgencyId
# path: index = int 0..9 (must be < len(checkpoints)); bookingId = TAKI\d{8}
```

### 11.2 Response deltas

- `DriverShipmentDTO`:
  - adds `state: BookingStateDTO` and `matchType`;
  - `DriverAddressDTO` gains `lat`, `lng` and `mapsUrl = "https://www.google.com/maps/dir/?api=1&destination={lat},{lng}"` (built from the geocoded address; no key);
  - `customer.phone` and `receiver.phone` follow the **contact access rule**: present only while the booking is paid and fulfilment is `not_started`, `picked_up`, `in_transit` or `out_for_delivery`; `null` after delivery, refusal or closure;
  - `allowedActions` is computed by `views/driver.py` from the state machines.
- `DriverTripDTO` / `DriverTripCheckpointDTO` gain `lat`, `lng` and `placeId`. `DriverTripDTO` gains `routePolyline`. `capacity` is leg-based.
- `DriverEventDTO`: `byRole` adds `admin`.

### 11.3 Endpoints

| # | Method & path | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|
| E86 | `GET /driver/dashboard` | — | 200 `DriverDashboardDTO` (works unlinked: `approved: false`, zero counts) | — | `GET /api/driver/dashboard` |
| E87 | `GET /driver/trips` | `DriverTripsQuery` | 200 bounded `{items: DriverTripListItem[]}` (≤ 50) | 403 `driver_not_linked` | `GET /api/driver/trips` |
| E88 | `GET /driver/trips/{tripId}` | — | 200 `DriverTripDTO` (checkpoints with paid pickups and drops per stop; events) | 404; 403 | `GET /api/driver/trips/[tripId]` |
| E89 | `POST /driver/trips/{tripId}/checkpoints/{index}/arrive` | `CheckpointActionBody` | 200 `DriverTripDTO`. Records `actualArrivalAt`, a trip event, fan-out booking events, and auto `out_for_delivery` at drops (A§13.1). | 409 `checkpoint_out_of_order` (`details.expected: {kind, index}`), `invalid_transition` (trip not in progress; index 0 has no arrive) | `POST /api/driver/trips/[tripId]/checkpoints/[index]/arrive` |
| E90 | `POST /driver/trips/{tripId}/checkpoints/{index}/depart` | `CheckpointActionBody` | 200 `DriverTripDTO`. Index 0 **starts** the trip (`published` → `in_progress`, from `departureAt − 2 h`). Auto `in_transit` for picked-up bookings with `pickup.index ≤ index`. | 409 `checkpoint_out_of_order`, `invalid_transition` (last stop has no depart); 422 `too_early` | `POST /api/driver/trips/[tripId]/checkpoints/[index]/depart` |
| E91 | `POST /driver/trips/{tripId}/complete` | `{}` | 200 `DriverTripDTO` (`completed`; schedules freed) | 409 `undelivered_shipments`, `invalid_transition` (not arrived at destination) | `POST /api/driver/trips/[tripId]/complete` |
| E92 | `GET /driver/shipments` | `DriverShipmentsQuery` | 200 `Page[DriverShipmentListItem]` | 403 | `GET /api/driver/shipments` |
| E93 | `GET /driver/shipments/{bookingId}` | — | 200 `DriverShipmentDTO` | 404 | `GET /api/driver/shipments/[bookingId]` |
| E94 | `POST /driver/shipments/{bookingId}/pickup` | `PickupBody` | 200 `DriverShipmentDTO` (fulfilment `picked_up`; customer notified) | 422 `otp_invalid` (`details.attemptsLeft`), `too_many_attempts` (the customer must regenerate), `too_early`; 409 `invalid_transition` | `POST /api/driver/shipments/[bookingId]/pickup` |
| E95 | `POST /driver/shipments/{bookingId}/refuse-pickup` | `RefusePickupBody` | 200 `DriverShipmentDTO` (closure cancelled / `pickup_refused`; full refund queued; customer and agency notified) | 409 `invalid_transition` | `POST /api/driver/shipments/[bookingId]/refuse-pickup` |
| E96 | `POST /driver/shipments/{bookingId}/start-transit` | `CheckpointActionBody` | 200 `DriverShipmentDTO` (manual fallback: `picked_up` → `in_transit`) | 409 `invalid_transition` | `POST /api/driver/shipments/[bookingId]/start-transit` |
| E97 | `POST /driver/shipments/{bookingId}/out-for-delivery` | `CheckpointActionBody` | 200 `DriverShipmentDTO` (manual fallback; customer notified) | 409 `invalid_transition` | `POST /api/driver/shipments/[bookingId]/out-for-delivery` |
| E98 | `POST /driver/shipments/{bookingId}/deliver` ⓜ | deliver fields + `proof` files | 200 `DriverShipmentDTO` (fulfilment `delivered`, reservation `consumed`; earning created; customer and agency notified). Files are stored before the transaction and deleted again if it fails. | 422 `otp_invalid`, `too_many_attempts`, `proof_required`, `file_invalid`; 413; 409 `invalid_transition` (not out for delivery) | `POST /api/driver/shipments/[bookingId]/deliver` |
| E99 | `POST /driver/shipments/{bookingId}/remarks` | `RemarkBody` | 201 `DriverEventDTO` (visible to customer and agency) | 409 `invalid_transition` (closed) | `POST /api/driver/shipments/[bookingId]/remarks` |
| E100 | `GET /driver/history` | `DriverHistoryQuery` | 200 `DriverHistoryDTO` `{items, nextCursor}` (delivered bookings; `proofThumbUrl` signed) | — | `GET /api/driver/history` |
| E101 | `GET /driver/profile` | — | 200 `DriverAppProfileDTO` `{account: DriverProfileDTO, reviews}` | — | `GET /api/driver/profile` |
| E102 | `PATCH /driver/profile` | `DriverProfilePatchBody` | 200 `DriverAppProfileDTO` (name fanned out to open trips and bookings) | — | `PATCH /api/driver/profile` |
| E103 | `POST /driver/agency-link` | `AgencyLinkBody` | 200 `DriverAppProfileDTO` (link `pending`; agency notified) | 409 `invalid_transition` (link already `active` or `pending`); 404 (agency not verified) | `POST /api/driver/agency-link` |

---

## 12. Notifications and reviews (D4)

| # | Method & path | Role | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|---|
| E104 | `GET /notifications` | any | `CursorQuery` + `unreadOnly: bool = false` | 200 `Page[NotificationDTO]` | — | `GET /api/notifications` |
| E105 | `GET /notifications/unread-count` | any | — | 200 `{count: int}` (aggregate count; the client polls every 30 s while visible) | — | `GET /api/notifications/unread-count` |
| E106 | `POST /notifications/read` | any | `{ids: list[NotificationId] (1..50)}` **or** `{all: true}` | 204 (only the caller's notifications are touched; unknown ids are ignored) | — | `POST /api/notifications/read` |
| E107 | `GET /reviews` | any | `CursorQuery` + exactly one of `driverId: Uid`, `agencyId: AgencyId` | 200 `Page[ReviewDTO]` (customer first name only) | 400 (neither or both) | `GET /api/reviews` |

---

## 13. Admin console (D2)

- Role `admin` (created only by `scripts/create_admin.py`; login E8 with `role: "admin"`).
- Every mutating admin call writes `auditLog`.
- Document numbers are always masked. Files are opened through signed URLs.

```python
class AdminListQuery: status: Literal["not_submitted","pending","verified","rejected","suspended"] = "pending"
class RejectBody(BaseModel): reason: Reason
class SuspendBody(BaseModel): reason: Reason
class SettleBody(BaseModel):                          # = TS SettleBody
    agencyId: AgencyId; through: IsoDate
    reference: str = Field(min_length=4, max_length=40, pattern=r"^[A-Za-z0-9/_-]+$")   # bank UTR
class AdminPaymentsQuery(CursorQuery): status: PaymentStatus = "refund_failed"
class DisableUserBody(BaseModel): reason: Reason
```

`AdminAgencyListItemDTO`, `AdminAgencyDetailDTO`, `AdminDriverListItemDTO`, `AdminDriverDetailDTO`, `AdminOverviewDTO`, `AdminSettlementRowDTO` and `AdminSettlementResultDTO` are as in TS `admin.ts`, with §2 deltas:
- `districtName` comes from `base`.
- `AdminAgencyDetailDTO` adds `base: PlaceDTO` and `duplicateDocumentFlags: [{kind, otherAccountType, otherAccountId}]` (same `numberHmac` on another account; the number is never shown).
- `AdminOverviewDTO` adds `vehicles: {awaitingRcReview}` and `payments: {refundFailed, pendingOver1h}`.

New DTOs:
- `AdminVehicleRcItemDTO`: `{vehicleId, agencyId, agencyName, registrationNumber, vehicleClass, rc: DocumentDTO, rcVerification, createdAt}`.
- `AdminPaymentRowDTO`: `{id, bookingId, customerId, agencyId, status, amountRupees, failureReason, cfOrderStatus, refund, createdAt, updatedAt}`.
- `AdminSettlementHistoryDTO`: `{id, agencyId, agencyName, amount, bookings, reference, periodThrough, settledAt, recordedBy}`.

| # | Method & path | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|
| E108 | `GET /admin/overview` | — | 200 `AdminOverviewDTO` | — | `GET /api/admin/overview` |
| E109 | `GET /admin/agencies` | `AdminListQuery` + `CursorQuery` | 200 `Page[AdminAgencyListItemDTO]` | — | `GET /api/admin/agencies` |
| E110 | `GET /admin/agencies/{agencyId}` | — | 200 `AdminAgencyDetailDTO` | 404 | `GET /api/admin/agencies/[agencyId]` |
| E111 | `POST /admin/agencies/{agencyId}/verify` | `{}` | 200 `AdminAgencyDetailDTO` (→ `verified`; notify `agency_verified`) | 409 `invalid_transition` (documents incomplete: `details.missing`) | `POST /api/admin/agencies/[agencyId]/verify` |
| E112 | `POST /admin/agencies/{agencyId}/reject` | `RejectBody` | 200 `AdminAgencyDetailDTO` (→ `rejected`; notify) | 409 `invalid_transition` | `POST /api/admin/agencies/[agencyId]/reject` |
| E113 | `POST /admin/agencies/{agencyId}/suspend` | `SuspendBody` | 200 `AdminAgencyDetailDTO` (→ `suspended`). Published trips stay visible to existing bookings but stop matching (search keys cleared); new requests and accepts are blocked. | 409 `invalid_transition` | — (new) |
| E114 | `POST /admin/agencies/{agencyId}/reinstate` | `{}` | 200 `AdminAgencyDetailDTO` (→ `verified`; search keys restored for future published trips) | 409 | — (new) |
| E115 | `GET /admin/drivers` | `AdminListQuery` + `CursorQuery` | 200 `Page[AdminDriverListItemDTO]` | — | `GET /api/admin/drivers` |
| E116 | `GET /admin/drivers/{driverId}` | — | 200 `AdminDriverDetailDTO` | 404 | `GET /api/admin/drivers/[driverId]` |
| E117 | `POST /admin/drivers/{driverId}/verify` | `{}` | 200 `AdminDriverDetailDTO` (→ `verified`; notify `driver_verified`) | 409 `invalid_transition` (documents incomplete, or the DL has expired) | `POST /api/admin/drivers/[driverId]/verify` |
| E118 | `POST /admin/drivers/{driverId}/reject` | `RejectBody` | 200 `AdminDriverDetailDTO` (→ `rejected`; notify) | 409 | `POST /api/admin/drivers/[driverId]/reject` |
| E119 | `GET /admin/vehicles` | `AdminListQuery` (on `rcVerification.status`) + `CursorQuery` | 200 `Page[AdminVehicleRcItemDTO]` | — | — (new) |
| E120 | `POST /admin/vehicles/{vehicleId}/rc/verify` | `{}` | 200 `AdminVehicleRcItemDTO` (notify `vehicle_rc_verified`) | 409 `invalid_transition` (no RC) | — (new) |
| E121 | `POST /admin/vehicles/{vehicleId}/rc/reject` | `RejectBody` | 200 `AdminVehicleRcItemDTO` (notify `vehicle_rc_rejected`) | 409 | — (new) |
| E122 | `GET /admin/settlements` | — | 200 `{items: AdminSettlementRowDTO[], available: true}` (agencies with `pending` earnings) | — | `GET /api/admin/settlements` |
| E123 | `POST /admin/settlements` | `SettleBody` | 201 `AdminSettlementResultDTO` (earnings with `deliveredAt ≤ through` (IST end of day) → `settled`, in batches; agency notified `settlement_recorded`) | 409 `conflict` (nothing pending up to that date), `already_exists` (reference reused for that agency) | `POST /api/admin/settlements` |
| E124 | `GET /admin/settlements/history` | `CursorQuery` + `agencyId?` | 200 `Page[AdminSettlementHistoryDTO]` | — | — (new) |
| E125 | `POST /admin/users/{uid}/disable` | `DisableUserBody` | 204 (Firestore `disabled`, Auth `disabled`, sessions revoked) | 409 `invalid_transition` (disabling oneself or the last admin) | — (new; was `ops user:disable`) |
| E126 | `POST /admin/users/{uid}/enable` | `{}` | 204 | 404 | — (new) |
| E127 | `GET /admin/payments` | `AdminPaymentsQuery` | 200 `Page[AdminPaymentRowDTO]` | — | — (new) |
| E128 | `POST /admin/payments/{paymentId}/retry-refund` | `{}` | 200 `AdminPaymentRowDTO` (`refund_failed` → `refund_pending`; new refund job with the same `refund_id`, so Cashfree deduplicates) | 409 `refund_not_allowed`; 501 `payments_not_configured` | — (new; was `ops jobs:retry`) |

---

## 14. Internal (D4)

| # | Method & path | Role | Request | 2xx | Errors | Replaces |
|---|---|---|---|---|---|---|
| E129 | `POST /internal/sweep` | system: Google OIDC (`aud = SWEEP_OIDC_AUDIENCE`, email in `SWEEP_INVOKER_EMAILS`) **or** `Bearer CRON_SECRET` | — | 200 `{expiredRequests, expiredPayments, reconciledPayments, jobsRun, jobsFailed, invitesExpired, orphanUsersDeleted, durationMs}` | 401 `unauthenticated`; 503 `cron_not_configured` (neither OIDC nor a secret is configured) | `POST /api/internal/sweep`, `GET /api/internal/sweep` (GET dropped: state changes need POST) |

**Total: 129 endpoints** (E1–E129).

---

## 15. Cross-cutting behaviour every implementer must honour

1. **Lazy expiry:** E34, E37–E39, E42–E44, E81–E83 and E93–E98 run `expire_if_due` before acting (A§8.2).
2. **Idempotent state actions:** repeating accept, reject, cancel, pickup, deliver, arrive or depart after success returns 200 with the current DTO and no new side effects. A different conflicting action returns 409 `invalid_transition`.
3. **Status consistency:** every booking DTO is built from the same booking document. `status`, `tab`, `agencyTab` and `driverTab` are produced only by `derive_status()`.
4. **Notifications** are written in the same transaction as the change they describe.
5. **No fabricated data:** no seed, no sample records, no simulated payment, no synthetic location. Lists are empty until real records exist.
6. **Rate limits** apply per A§5.8 (E4–E9, E15, E16, E23, E24, E32–E34, E42, E44 and every upload).
7. **OpenAPI:** each router declares `response_model` and `responses={code: {"model": ErrorBody}}` so `openapi.json` documents the error envelope.

---

## Appendix A — every current route → v3 endpoint

| # | Today (`src/app/api/...`) | Methods | v3 |
|---|---|---|---|
| 1 | `admin/agencies` | GET | E109 |
| 2 | `admin/agencies/[agencyId]` | GET | E110 |
| 3 | `admin/agencies/[agencyId]/verify` | POST | E111 |
| 4 | `admin/agencies/[agencyId]/reject` | POST | E112 |
| 5 | `admin/drivers` | GET | E115 |
| 6 | `admin/drivers/[driverId]` | GET | E116 |
| 7 | `admin/drivers/[driverId]/verify` | POST | E117 |
| 8 | `admin/drivers/[driverId]/reject` | POST | E118 |
| 9 | `admin/overview` | GET | E108 |
| 10 | `admin/settlements` | GET, POST | E122, E123 |
| 11 | `agency/bookings` | GET | E80 |
| 12 | `agency/bookings/[bookingId]` | GET | E81 |
| 13 | `agency/bookings/[bookingId]/accept` | POST | E82 |
| 14 | `agency/bookings/[bookingId]/reject` | POST | E83 |
| 15 | `agency/dashboard` | GET | E47 |
| 16 | `agency/driver-invites` | GET, POST | E66, E67 |
| 17 | `agency/driver-invites/[inviteId]` | DELETE | E68 |
| 18 | `agency/drivers` | GET | E60 |
| 19 | `agency/drivers/[driverId]` | GET, PATCH, DELETE | E61, E62, E65 |
| 20 | `agency/drivers/[driverId]/approve` | POST | E63 |
| 21 | `agency/drivers/[driverId]/reject` | POST | E64 |
| 22 | `agency/earnings` | GET | E85 |
| 23 | `agency/history` | GET | E84 |
| 24 | `agency/profile` | GET, PATCH | E48, E49 |
| 25 | `agency/trips` | GET, POST | E71, E72 |
| 26 | `agency/trips/[tripId]` | GET, PATCH, DELETE | E73, E74, E75 |
| 27 | `agency/trips/[tripId]/cancel` | POST | E78 |
| 28 | `agency/trips/[tripId]/publish` | POST | E76 |
| 29 | `agency/trips/[tripId]/reassign` | POST | E79 |
| 30 | `agency/trips/[tripId]/unpublish` | POST | E77 |
| 31 | `agency/trips/form-options` | GET | E69 |
| 32 | `agency/trips/preview` | POST | E70 |
| 33 | `agency/vehicles` | GET, POST | E52, E53 |
| 34 | `agency/vehicles/[vehicleId]` | GET, PATCH, DELETE | E54, E55, E56 |
| 35 | `agency/vehicles/[vehicleId]/photos` | POST | E57 |
| 36 | `agency/vehicles/[vehicleId]/photos/[fileId]` | DELETE | E58 |
| 37 | `agency/verification` | POST | E51 (+ E17 / E18 for files; E50 new GET) |
| 38 | `auth/login` | POST | E8 |
| 39 | `auth/logout` | POST | E10 (+ client `signOut()`) |
| 40 | `auth/otp/resend` | POST | **Removed**: the Firebase JS SDK resends (`signInWithPhoneNumber` again). Status after verification: E4. |
| 41 | `auth/otp/send-phone-change` | POST | **Removed**: Firebase phone proof in the browser; E16 |
| 42 | `auth/otp/send` | POST | **Removed**: Firebase `signInWithPhoneNumber` + reCAPTCHA; E4 |
| 43 | `auth/otp/verify` | POST | **Removed**: `confirmationResult.confirm(code)`; E4 (returns the driver invite as before) |
| 44 | `auth/password/reset` | POST | E9 |
| 45 | `auth/session` | GET | E11 |
| 46 | `auth/signup/agency` | POST | E6 |
| 47 | `auth/signup/customer` | POST | E5 |
| 48 | `auth/signup/driver` | POST | E7 |
| 49 | `customer/bookings` | GET, POST | E35, E34 |
| 50 | `customer/bookings/[bookingId]` | GET | E37 |
| 51 | `customer/bookings/[bookingId]/cancel` | POST | E38 |
| 52 | `customer/bookings/[bookingId]/otp/regenerate` | POST | E39 |
| 53 | `customer/bookings/[bookingId]/review` | POST | E41 |
| 54 | `customer/bookings/[bookingId]/tracking` | GET | E40 |
| 55 | `customer/bookings/counts` | GET | E36 |
| 56 | `customer/dashboard` | GET | E25 |
| 57 | `customer/payments` | GET | E46 |
| 58 | `customer/search` | GET | E32 (`from` / `to` districts → `fromPlaceId` / `toPlaceId`) |
| 59 | `customer/shipments` | GET, POST | E27, E26 |
| 60 | `customer/shipments/[shipmentId]` | GET, PATCH, DELETE | E28, E29, E30 |
| 61 | `customer/shipments/[shipmentId]/offers` | GET | E31 |
| 62 | `customer/trips/[tripId]` | GET | E33 |
| 63 | `driver/agency-link` | POST | E103 |
| 64 | `driver/dashboard` | GET | E86 |
| 65 | `driver/history` | GET | E100 |
| 66 | `driver/profile` | GET, PATCH | E101, E102 |
| 67 | `driver/shipments` | GET | E92 |
| 68 | `driver/shipments/[bookingId]` | GET | E93 |
| 69 | `driver/shipments/[bookingId]/pickup` | POST | E94 |
| 70 | `driver/shipments/[bookingId]/refuse-pickup` | POST | E95 |
| 71 | `driver/shipments/[bookingId]/start-transit` | POST | E96 |
| 72 | `driver/shipments/[bookingId]/out-for-delivery` | POST | E97 |
| 73 | `driver/shipments/[bookingId]/deliver` | POST | E98 |
| 74 | `driver/shipments/[bookingId]/remarks` | POST | E99 |
| 75 | `driver/trips` | GET | E87 |
| 76 | `driver/trips/[tripId]` | GET | E88 |
| 77 | `driver/trips/[tripId]/checkpoints/[index]/arrive` | POST | E89 |
| 78 | `driver/trips/[tripId]/checkpoints/[index]/depart` | POST | E90 |
| 79 | `driver/trips/[tripId]/complete` | POST | E91 |
| 80 | `files/[fileId]` | GET | E21 (authorise + URL) and E22 (stream) |
| 81 | `geo/districts` | GET | **Removed**: Places Autocomplete (browser key); states in E3 |
| 82 | `geo/nearest-district` | GET | E24 |
| 83 | `health` | GET | E1, E2 |
| 84 | `internal/sweep` | GET, POST | E129 (POST only) |
| 85 | `me` | GET | E12 |
| 86 | `me/documents/[kind]` | PUT | E18 |
| 87 | `me/password` | POST | E15 |
| 88 | `me/phone` | POST | E16 |
| 89 | `me/photo` | PUT | E17 |
| 90 | `me/profile` | GET, PATCH | E13, E14 |
| 91 | `notifications` | GET | E104 |
| 92 | `notifications/read` | POST | E106 |
| 93 | `notifications/unread-count` | GET | E105 |
| 94 | `payments/[paymentId]` | GET | E43 (read), E44 (verify) |
| 95 | `payments/cashfree/order` | POST | E42 |
| 96 | `payments/cashfree/verify` | GET | E44 |
| 97 | `payments/cashfree/webhook` | POST | E45 |
| 98 | `payments/dev/confirm` | POST | `POST /api/v1/payments/dev/confirm`: dev/test only (owner kept the dev gateway; refused outside development/test) |
| 99 | `payments/orders` | POST | E42 |
| 100 | `public/agencies` | GET | E19 |
| 101 | `public/contact` | POST | E20 |
| 102 | `reviews` | GET | E107 |

**Summary:**
- 102 route files are covered.
- 6 have no direct successor, all intentional: the 4 OTP routes and the districts list (replaced by Firebase phone auth and Google Places), and the dev payment confirm (prohibited).
- 25 endpoints are new: E2–E4 and E23 (status, meta, maps); E44 (explicit verify, previously verify-on-GET); E50; E59; E113–E114; E119–E121; E124–E128 (admin); and the split pieces E21 / E22 and E43 / E44.
