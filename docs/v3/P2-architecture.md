# TAKI v3 — Backend Architecture (P2)

Author: P2 (planning). Date: 2026-11-15. Branch: `feat/fastapi-monorepo`.
Companion: `docs/v3/P2-api-contract.md` (every endpoint, schema and error code).

Inputs studied: `src/server/**` (modules, core, db/schema.ts, http/handler.ts, payments, files, views), `src/lib/api/contracts/**`, `src/lib/api/client/**`, `src/lib/domain/**` (booking-machine, capacity, matching, pricing, segments, constants), `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firebase.json`, `docs/planning/**` (especially `v2/p2-backend.md`, `v2/01-plan.md` and `v2/00-requirements.md`).

**The v2 design (`docs/planning/v2/p2-backend.md`) is the baseline.** Everything it says about business rules still applies unless this document changes it. The v3 changes are:
1. FastAPI replaces the Next.js route handlers.
2. Firebase Auth replaces server sessions.
3. Google Maps replaces the district dataset.
4. Booking state is split into separate state machines.
5. Capacity is tracked per route leg instead of for the whole trip.
6. There is no dev payment gateway.
7. The database starts empty, with no seed.

---

## 0. Decisions at a glance

| # | Topic | Decision |
|---|---|---|
| 0.1 | Backend | **Python 3.12 + FastAPI**. Async throughout, using `google.cloud.firestore.AsyncClient` from `firebase_admin.firestore_async`. Pydantic v2 for every request and response model. One Docker image deployed to **Cloud Run** (`asia-south1`). No TypeScript server code remains. `src/server/**` and `src/app/api/**` are deleted once parity tests pass (§17). |
| 0.2 | Monorepo | `apps/web/` (Next.js 16, moved unchanged), `backend/app/`, `backend/tests/`, `firebase/` (rules, indexes, `firebase.json`), `docs/`, `scripts/`, `.github/workflows/`. |
| 0.3 | Identity | **Firebase Auth** is the identity provider. The Firebase `uid` is the user id everywhere: `users/{uid}`, `customers/{uid}`, `drivers/{uid}`, `booking.customerId`, `trip.driverId`. The `usr_*` ids are gone. |
| 0.4 | Signup and reset | Firebase **phone OTP with reCAPTCHA**, done in the browser. The browser sends the resulting *phone-proof* ID token to FastAPI, which creates the account or resets the password. |
| 0.5 | Daily login | **Phone + password, verified by FastAPI**. Firestore stores an argon2id hash. On success FastAPI mints a Firebase **custom token**, and the browser calls `signInWithCustomToken`. Option C in §5.1; the synthetic-email options were rejected. |
| 0.6 | API auth | `Authorization: Bearer <Firebase ID token>` on every call, with no cookies. FastAPI verifies the token with the Admin SDK and loads `users/{uid}`, which is the authoritative source for role, status and revocation. Custom claims `{role, agencyId}` exist only for frontend routing. |
| 0.7 | Booking state | Four independent fields: `approvalStatus`, `paymentStatus`, `reservationStatus` and `fulfilmentStatus`, plus `closure`. The legacy `status` and `tab` values are **derived** from them by one pure function and stored for queries. This keeps the existing frontend DTOs working. |
| 0.8 | Capacity | **Per-leg (segment-aware)** ledger on the trip document. `available(i→j) = offeredKg − max load on legs i..j−1`. It is reserved at **acceptance**, inside a Firestore transaction. Workflow step 10: "Acceptance → capacity reserved". |
| 0.9 | Matching | Each pickup checkpoint publishes geohash-4 cells (the cell and its 8 neighbours, keyed with the IST date) in `trip.searchKeys`. Search runs **one** `array-contains` query, then exact filters: haversine within the checkpoint's service radius, pickup index < drop index, time, goods, per-leg capacity. Road distances come from Google **Route Matrix**, cached. **Pincodes are never used for matching.** |
| 0.10 | Maps | A server key (Geocoding, Routes `computeRoutes` and `computeRouteMatrix`) used only inside FastAPI. A browser key restricted by referrer (Places Autocomplete and Maps JS). Leg distances, durations and the encoded polyline are computed once and cached on the trip. No GPS is fabricated: `liveLocation` is always `null`. |
| 0.11 | Payments | Full Cashfree PG integration (orders, verify, signed webhooks, refunds). **There is no dev gateway.** Without credentials, every payment endpoint returns 501 `payments_not_configured`. A booking reaches `paid` only through `confirm_payment()`, and only after the Cashfree API or a verified webhook reports `PAID` with a matching amount. |
| 0.12 | Firestore and Storage rules | Deny all. Every read and write goes through FastAPI with the Admin SDK. Storage adds one defence-in-depth read rule for owner or admin on `users/{uid}/**`. Files are uploaded to FastAPI as multipart and read through short-lived **HMAC-signed content URLs** that FastAPI issues, so `<img src>` works without an `Authorization` header. |
| 0.13 | Side effects | State changes, events and notifications are written in one transaction. External calls (Cashfree refunds) go into the `jobs` outbox in the same transaction. They run after commit (`BackgroundTasks`) and are retried by the sweep. |
| 0.14 | Scheduler | Cloud Scheduler calls `POST /api/v1/internal/sweep` every 5 minutes with a Google OIDC token. Correctness never depends on the sweep: expiry is checked lazily inside transactions, and an unpaid hold stops counting at its `dueAt`. |
| 0.15 | Errors | The error envelope is unchanged: `{"error":{"code","message","fields"?,"details"?}}`. The v2 `ERROR_CATALOG` is ported to `core/errors.py` with the same codes and HTTP statuses. Validation errors return **400** `invalid_request` (not FastAPI's default 422). |
| 0.16 | Data | The production database starts **empty**. There is no seed module. The only bootstrap is `scripts/create_admin.py`, an ops CLI that creates one admin user. Tests build their own fixtures through the services. |

---

## 1. Repository layout

```
/
├─ apps/web/                      Next.js 16 + React 19 (moved from repo root; D1)
│   ├─ src/…                      unchanged structure; src/server/** and src/app/api/** DELETED at the end
│   ├─ src/lib/api/http.ts        fetch wrapper → NEXT_PUBLIC_API_BASE_URL + Bearer token
│   ├─ src/lib/api/contracts/**   TS DTOs (kept; regenerated/checked against OpenAPI, §15.6)
│   ├─ src/lib/firebase/**        client SDK init, AuthProvider, phone-OTP helpers (new)
│   ├─ apphosting.yaml            Firebase App Hosting config (env + secrets refs)
│   └─ package.json
├─ backend/
│   ├─ app/                       FastAPI application (§2)
│   ├─ tests/                     pytest suites (§15)
│   ├─ pyproject.toml             uv-managed; ruff, mypy config
│   ├─ uv.lock
│   ├─ Dockerfile
│   └─ .env.example
├─ firebase/
│   ├─ firebase.json              emulators: auth 9099, firestore 8080, storage 9199, ui 4000
│   ├─ .firebaserc                default "demo-taki"
│   ├─ firestore.rules            deny all
│   ├─ firestore.indexes.json     §11
│   └─ storage.rules              §12.2
├─ scripts/
│   ├─ create_admin.py            bootstrap an admin user (prod and emulator)
│   ├─ dev.ps1 / dev.sh           start emulators + uvicorn --reload + next dev
│   └─ check_invariants.py        capacity / state invariants over a project (read-only)
├─ docs/v3/**
└─ .github/workflows/{backend.yml, web.yml, deploy.yml}
```

---

## 2. Backend package layout (`backend/app/`)

```
app/
├─ main.py                      create_app(): settings, logging, middleware, exception handlers, routers, lifespan
├─ deps.py                      DI: get_settings, get_db, get_clock, get_current_user, require_role(...),
│                               require_phone_proof, get_optional_user, idempotency_key, rate_limit(...)
├─ core/
│   ├─ config.py                Settings(BaseSettings) — §4
│   ├─ logging.py               JSON structured logs (Cloud Logging format), request-id/trace correlation, PII scrubber
│   ├─ errors.py                AppError, ERROR_CATALOG (ported 1:1 + new codes §3.3), handlers
│   ├─ clock.py                 Clock protocol; SystemClock; FrozenClock (tests only)
│   ├─ ids.py                   new_id(prefix) "trp_"+20 [a-z0-9]; new_booking_id() "TAKI"+8 digits
│   ├─ time.py                  IST helpers: ist_today(), ist_date_of(dt), to_utc(), iso_z(dt)
│   ├─ security.py              argon2id hashing, HMAC helpers, file-URL signing, OTP encryption (Fernet)
│   ├─ pagination.py            encode_cursor/decode_cursor/page_of
│   └─ constants.py             LIMITS, V3 business constants (ported from src/lib/domain/constants.ts)
├─ middleware/
│   ├─ request_id.py            X-Request-ID in/out (uuid4 if absent), contextvar
│   ├─ access_log.py            method, route template, status, latency, uid (never bodies)
│   ├─ body_limit.py            413 file_too_large before parsing (JSON 1 MB, multipart 20 MB)
│   ├─ cors.py                  CORSMiddleware config from settings (no credentials; Authorization allowed)
│   └─ rate_limit.py            dependency factory backed by Firestore fixed windows (§5.8)
├─ api/v1/
│   ├─ router.py                includes every router under /api/v1
│   └─ routers/
│       ├─ health.py  meta.py
│       ├─ auth.py  me.py  public.py  files.py  admin.py
│       ├─ agency_profile.py  agency_vehicles.py  agency_drivers.py  agency_trips.py
│       ├─ agency_bookings.py  agency_history.py  agency_earnings.py  agency_dashboard.py
│       ├─ customer_shipments.py  customer_search.py  customer_bookings.py  customer_dashboard.py
│       ├─ driver_app.py  driver_trips.py  driver_shipments.py  driver_profile.py
│       ├─ notifications.py  reviews.py
│       ├─ payments.py  maps.py
│       └─ internal.py
├─ schemas/                     Pydantic request/response models (API surface; camelCase aliases)
│   ├─ common.py                Phone, Pincode, Ids, enums, Page[T], FileDTO, NotificationDTO, ReviewDTO, PlaceInput/PlaceDTO
│   ├─ errors.py                ErrorBody (for OpenAPI)
│   ├─ auth.py  profile.py  admin.py
│   ├─ agency.py  customer.py  driver.py
│   └─ payments.py  maps.py  notifications.py
├─ models/                      Firestore document models (Pydantic, snake_case in Python, camelCase in Firestore)
│   ├─ base.py                  DocModel (id, created_at, updated_at, version), to_firestore()/from_firestore()
│   ├─ user.py  agency.py  driver.py  vehicle.py  trip.py  shipment.py  booking.py
│   ├─ payment.py  file.py  notification.py  review.py  earning.py  job.py  misc.py
│   └─ enums.py                 every status enum (§7)
├─ domain/                      PURE logic, no I/O (unit-tested without emulators)
│   ├─ booking_machine.py       transitions of the 4 sub-machines + derive_status()/tab_of()
│   ├─ capacity.py              leg loads, available(i,j), fits(), invariant()
│   ├─ pricing.py               quote_v3(), service_fee_for(), round_half_up()
│   ├─ matching.py              match_trip(), candidate checkpoints, sort + badges
│   ├─ geo.py                   haversine, geohash encode/neighbours, search keys
│   ├─ trip_rules.py            checkpoint/time validation, publish blockers
│   ├─ documents.py             Aadhaar (Verhoeff), PAN, DL, RC normalisation + masking
│   ├─ vehicles.py              registration normalise/validate (ported normalizeReg)
│   └─ phone.py                 to_e164 (+91 Indian mobiles), mask_phone
├─ repositories/                Firestore access ONLY (no business rules)
│   ├─ base.py                  Repo[T]: get, get_many, query, page, tx_get/tx_set/tx_create/tx_update
│   ├─ collections.py           collection names + subcollection helpers
│   ├─ users.py  agencies.py  drivers.py  invites.py  vehicles.py  schedules.py  trips.py
│   ├─ shipments.py  bookings.py  booking_secrets.py  events.py
│   ├─ payments.py  webhook_events.py  idempotency.py  rate_limits.py
│   ├─ files.py  notifications.py  reviews.py  earnings.py  settlements.py  jobs.py  caches.py  audit.py  contact.py
├─ services/                    business logic + transactions (call domain/*, repositories/*, integrations/*)
│   ├─ auth_service.py          signup ×3, login, reset, change password/phone, logout, claims sync
│   ├─ profile_service.py       profile get/patch, photo, identity documents, verification submit
│   ├─ admin_service.py         review queues, verify/reject/suspend, settlements, user disable, refunds retry
│   ├─ agency_service.py        agency profile, dashboard, history
│   ├─ vehicle_service.py       vehicles, photos, RC
│   ├─ driver_mgmt_service.py   agency drivers, invites, links, availability
│   ├─ trip_service.py          drafts, preview, publish/unpublish/cancel/reassign (schedules), form options
│   ├─ shipment_service.py      shipments CRUD + geocoding of addresses
│   ├─ search_service.py        offers, guest search, trip details
│   ├─ booking_service.py       request/accept/reject/cancel/expire/refuse/pickup/transit/deliver/review/otp
│   ├─ tracking_service.py      checkpoint arrive/depart fan-out, complete trip, timelines
│   ├─ notification_service.py  notify() inside tx; list/read
│   ├─ earnings_service.py      earnings read models, settlement math
│   ├─ payment_service.py       create order, status, verify, webhook, confirm_payment, refunds
│   ├─ file_service.py          upload validation (magic bytes), store, authorise, signed content URLs
│   ├─ jobs_service.py          outbox runner (refund jobs), backoff
│   └─ sweep_service.py         expiry sweep, payment reconciliation, orphan auth users
├─ views/                       role projections: doc → DTO (the ONLY place that builds response JSON)
│   ├─ common.py  customer.py  agency.py  driver.py  admin.py
├─ integrations/
│   ├─ firebase/app.py          initialize_app once; emulator detection; project guards
│   ├─ firebase/auth.py         verify_id_token, create_custom_token, set claims, update/delete user, revoke (threadpool)
│   ├─ firebase/storage.py      bucket put/get/delete (async via threadpool)
│   ├─ maps/client.py           GoogleMapsClient protocol + HttpGoogleMapsClient (httpx) + caching
│   ├─ maps/models.py           GeocodedPlace, RouteResult, MatrixElement
│   ├─ cashfree/client.py       CashfreeClient protocol + HttpCashfreeClient (httpx)
│   ├─ cashfree/webhook.py      verify_signature(), parse_event()
│   └─ cashfree/models.py       CfOrder, CfPayment, CfRefund, GatewayEvent
│   (sms: none — OTPs are sent by Firebase Auth; there is no transactional SMS in v3)
└─ tests_support/               NOT imported by app code (guarded): fakes used by backend/tests
    ├─ fake_cashfree.py  fake_maps.py  frozen_clock.py
```

**Layering rules (lint-enforced with `import-linter`):**
- `routers` → `services` / `views` / `schemas` / `deps`
- `services` → `domain` / `repositories` / `integrations` / `models` / `core`
- `domain` imports only `core.constants`, `core.errors` and `models.enums`.
- `repositories` never import `services`.
- Only `views/*` turns a document into a response DTO, and no router returns a model or raw dict from Firestore.
- `tests_support` cannot be imported from `app/**`. An import-linter contract enforces this, and fakes are injected through `app.dependency_overrides` in tests only.

### 2.1 Request pipeline

Order, outermost first:
1. `RequestIdMiddleware`
2. `AccessLogMiddleware`
3. `CORSMiddleware`
4. `BodyLimitMiddleware`
5. Router dependencies, which resolve in this order:
   1. `get_settings`, `get_clock`
   2. auth (`get_current_user` / `require_role` / `require_phone_proof`)
   3. `rate_limit(...)` where declared
   4. path, query and body validation (Pydantic)
   5. `idempotency_key` (header) where declared

Exception handlers:
- `AppError` → envelope with its catalog status.
- `RequestValidationError` → 400 `invalid_request` with `fields` (§3.2).
- `HTTPException` 404/405 → `not_found` / `method_not_allowed`.
- `google.api_core.exceptions.Aborted` after retries → 409 `contention`.
- `ServiceUnavailable` / `DeadlineExceeded` → 503 `database_unavailable`.
- Anything else → 500 `internal`. The trace is logged and the message stays generic.

Every response carries `Cache-Control: no-store` (a response middleware sets it unless the route sets its own) and `X-Request-ID`. Webhooks and file content responses set their own headers.

Handlers are `async def`. Admin SDK Auth calls and Storage calls are synchronous libraries, so they run through `anyio.to_thread.run_sync` in `integrations/firebase/*`. The Firestore `AsyncClient` is used directly.

---

## 3. Error model

### 3.1 Envelope (unchanged from v2)

```json
{ "error": { "code": "insufficient_capacity", "message": "Not enough capacity left on this trip.", "fields": {"weightKg": "…"}, "details": {"availableKg": 120} } }
```

- `message` is user-facing copy, ported from `ERROR_CATALOG`; a call site may override it.
- `fields` maps a dotted request path to a message, for example `"source.pincode"` or `"checkpoints.2.expectedArrivalAt"`.
- `details` holds machine-readable extras, for example `bookingId`, `attemptsLeft`, `conflictingTripId`, `retryAfterSeconds` or `lockedUntil`.

```python
class AppError(Exception):
    def __init__(self, code: ErrorCode, message: str | None = None, *, status: int | None = None,
                 fields: dict[str, str] | None = None, details: dict[str, Any] | None = None): ...
```

### 3.2 Validation mapping

Each Pydantic error's `loc` is mapped to a camelCase dotted path; the leading `body` / `query` / `path` segment is dropped. Its `msg` becomes the field message. Custom validators raise `PydanticCustomError("phone", "Enter a valid 10-digit mobile number")`, so the copy matches today's zod messages. The status is 400 and the code is `invalid_request`.

### 3.3 Catalog

**Every code in `src/lib/api/contracts/errors.ts` is kept with the same status and message.** Changes:

| Code | Status | Change |
|---|---|---|
| `bad_origin` | 403 | **Removed.** Bearer tokens have no CSRF exposure, and CORS is the browser control. |
| `token_expired` | 401 | **New.** The ID token has expired, so the client force-refreshes and retries once. |
| `session_revoked` | 401 | **New.** Tokens were revoked (logout-all, password reset, disable), so the client signs out. |
| `phone_proof_required` | 401 | **New.** The endpoint needs a fresh phone-OTP token (≤ 10 min). |
| `password_login_required` | 403 | **New.** A phone-OTP token was used on a normal endpoint (§5.4). |
| `account_not_found` | 404 | **New.** Password reset for a phone with no TAKI account. |
| `account_exists` | 409 | **New.** The phone-proof uid already has a TAKI account. `phone_taken` is kept for phone change. |
| `wrong_role` | 403 | **New.** The password was correct but the account has another role. `details.role` is set. |
| `maps_not_configured` | 503 | **New.** |
| `maps_unavailable` | 502 | **New.** Google returned an error or timed out. |
| `address_not_found` | 422 | **New.** Geocoding returned no result. |
| `address_state_mismatch` | 422 | **New.** The geocoded state differs from the given state. Replaces `pincode_state_mismatch` and `district_state_mismatch`, which are removed. |
| `outside_service_area` | 422 | Kept. It now means the geocoded state is not in `SERVICE_STATES`, or the address is outside India. |
| `not_on_route` | 422 | Kept. Message: "This trip doesn't stop near your pickup and drop locations in that order." |
| `vehicle_documents_missing` | 409 | **New.** The RC is missing or not verified when publishing. |
| `driver_not_verified` | 409 | **New.** Assigning a driver whose documents are not verified. |
| `already_verified` | 409 | **New.** Replacing a document after verification. |
| `agency_suspended` | 403 | **New.** |
| `webhook_not_configured` | 501 | **New.** The webhook endpoint was called without Cashfree credentials. |
| `refund_not_allowed` | 409 | **New.** Admin refund retry in the wrong state. |
| `dev_gateway` codes | — | Removed with the dev gateway. |

---

## 4. Configuration (`core/config.py`)

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=True)
    APP_ENV: Literal["local", "test", "staging", "production"] = "local"
    LOG_LEVEL: str = "INFO"
    # Firebase / GCP
    FIREBASE_PROJECT_ID: str                          # "demo-taki" for emulators
    FIREBASE_STORAGE_BUCKET: str                      # "demo-taki.appspot.com" in emulators
    FIREBASE_WEB_API_KEY: SecretStr | None = None     # only needed by tests/scripts that exchange custom tokens
    FIRESTORE_EMULATOR_HOST: str | None = None
    FIREBASE_AUTH_EMULATOR_HOST: str | None = None
    FIREBASE_STORAGE_EMULATOR_HOST: str | None = None
    GOOGLE_APPLICATION_CREDENTIALS: str | None = None # local only; Cloud Run uses the service account (ADC)
    # HTTP
    APP_ORIGIN: AnyHttpUrl                            # frontend origin (Cashfree return_url, links)
    PUBLIC_API_BASE_URL: AnyHttpUrl                   # absolute API base (webhook notify_url, file URLs)
    CORS_ALLOWED_ORIGINS: list[str]                   # JSON list or comma-separated
    TRUST_PROXY_HEADERS: bool = False                 # true on Cloud Run
    # Secrets
    FILE_URL_SECRET: SecretStr                        # ≥32 bytes; signs file content URLs
    PII_HASH_KEY: SecretStr                           # ≥32 bytes; document-number HMAC; NEVER rotate
    OTP_ENC_KEY: SecretStr                            # Fernet key; encrypts pickup/delivery OTPs at rest
    PASSWORD_PEPPER: SecretStr | None = None          # optional HMAC pepper before argon2id
    # Google Maps (server key — never sent to browsers)
    GOOGLE_MAPS_SERVER_KEY: SecretStr | None = None
    MAPS_REGION: str = "in"; MAPS_LANGUAGE: str = "en-IN"
    SERVICE_STATES: list[StateCode] = ["TN", "KL", "KA", "TG", "AP"]
    # Cashfree
    CASHFREE_APP_ID: SecretStr | None = None
    CASHFREE_SECRET_KEY: SecretStr | None = None
    CASHFREE_ENV: Literal["sandbox", "production"] | None = None
    CASHFREE_API_VERSION: str = "2025-01-01"
    CASHFREE_WEBHOOK_TOLERANCE_SECONDS: int = 300
    # Scheduler
    SWEEP_OIDC_AUDIENCE: str | None = None            # Cloud Run URL; Cloud Scheduler OIDC aud
    SWEEP_INVOKER_EMAILS: list[str] = []              # allowed scheduler service-account emails
    CRON_SECRET: SecretStr | None = None              # fallback Bearer secret (local/manual)
    # Feature flags
    REQUIRE_DELIVERY_PROOF: bool = False              # owner: "OTP + optional photo"
    REQUIRE_DRIVER_VERIFICATION: bool = True          # driver docs verified by admin before trip assignment
    REQUIRE_VEHICLE_RC: bool = True                   # RC uploaded (and verified if REQUIRE_VEHICLE_RC_VERIFIED) to publish
    REQUIRE_VEHICLE_RC_VERIFIED: bool = False
    DEV_AUTO_VERIFY: bool = False                     # local/test only: verify agencies+drivers on submission
    RATE_LIMITS_ENABLED: bool = True
```

**Boot guards** (`integrations/firebase/app.py`, run in `lifespan`):
- `APP_ENV == "production"` with any `*_EMULATOR_HOST` set: refuse to start.
- `APP_ENV in {local, test}` with no emulator host and no credentials: refuse to start, with the message "Start the emulators: scripts/dev".
- `DEV_AUTO_VERIFY=true` outside local/test: refuse to start.
- `FIREBASE_PROJECT_ID` must start with `demo-` whenever an emulator host is set.
- Missing secrets (`FILE_URL_SECRET`, `PII_HASH_KEY`, `OTP_ENC_KEY`) are fatal in staging and production. In local and test, deterministic dev values are generated with a warning.
- Maps and Cashfree are **optional at boot**. Their absence makes only the dependent endpoints fail with clear codes.

### 4.1 Backend env vars (Cloud Run)

| Var | Local (emulators) | Staging / Prod | Secret? |
|---|---|---|---|
| `APP_ENV` | `local` | `staging` / `production` | no |
| `FIREBASE_PROJECT_ID` | `demo-taki` | real id | no |
| `FIREBASE_STORAGE_BUCKET` | `demo-taki.appspot.com` | `<id>.firebasestorage.app` | no |
| `FIRESTORE_EMULATOR_HOST` | `127.0.0.1:8080` | **unset** | no |
| `FIREBASE_AUTH_EMULATOR_HOST` | `127.0.0.1:9099` | **unset** | no |
| `FIREBASE_STORAGE_EMULATOR_HOST` | `127.0.0.1:9199` | **unset** | no |
| `APP_ORIGIN` | `http://localhost:3000` | `https://taki.example` | no |
| `PUBLIC_API_BASE_URL` | `http://localhost:8000` | `https://api.taki.example` | no |
| `CORS_ALLOWED_ORIGINS` | `["http://localhost:3000"]` | App Hosting URL(s) + custom domain | no |
| `TRUST_PROXY_HEADERS` | `false` | `true` | no |
| `FILE_URL_SECRET`, `PII_HASH_KEY`, `OTP_ENC_KEY`, `PASSWORD_PEPPER` | dev defaults | Secret Manager | **yes** |
| `GOOGLE_MAPS_SERVER_KEY` | optional (FakeMaps in tests) | Secret Manager | **yes** |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` | sandbox keys or unset | Secret Manager (placeholders until the owner provides them) | **yes** |
| `CASHFREE_ENV` | `sandbox` | `sandbox` → `production` | no |
| `CASHFREE_API_VERSION` | `2025-01-01` | same | no |
| `SWEEP_OIDC_AUDIENCE`, `SWEEP_INVOKER_EMAILS` | unset | Cloud Run URL, scheduler SA | no |
| `CRON_SECRET` | any | Secret Manager (optional) | **yes** |
| `REQUIRE_*`, `DEV_AUTO_VERIFY` | see defaults | defaults; `DEV_AUTO_VERIFY` must be false | no |

### 4.2 Frontend env vars (`apps/web`, App Hosting `apphosting.yaml`)

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | FastAPI base, e.g. `https://api.taki.example`. In local dev the value is `/api` and Next `rewrites()` proxies `/api/v1/:path*` → `http://localhost:8000/api/v1/:path*`. |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase JS SDK (Auth only; the client never uses Firestore or Storage) |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL` | `http://127.0.0.1:9099` in local dev; unset in prod. When set, `connectAuthEmulator` is used and reCAPTCHA is bypassed by the emulator. |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | Restricted browser key: HTTP referrers = app domains; APIs = Maps JavaScript API and Places API (New) |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Optional cloud map style id |
| `NEXT_PUBLIC_APP_ENV` | `local` / `staging` / `production` (labels such as "Dev OTP") |

Removed: `NEXT_PUBLIC_APP_MODE`, every `SESSION_SECRET`, `SMS_*` and `PAYMENT_PROVIDER` variable, and the `MSG91_*` variables. The Cashfree **mode** reaches the browser in the order response (`checkout.mode`), not through an env var.

---

## 5. Authentication and authorisation

### 5.1 Password-login options evaluated

| Option | How it works | Server-side lockout | Enumeration and role control | Extra infra | Verdict |
|---|---|---|---|---|---|
| **A.** Firebase email/password with a synthetic email `91XXXXXXXXXX@phone.taki.invalid`, linked to the phone user | The browser calls `signInWithEmailAndPassword` | **No.** Only Firebase's opaque throttling applies, and anyone can call Identity Toolkit directly with the public API key. | The client must know the synthetic-email scheme. Role mismatch is detected only after login. | None | Rejected: lockout and rate limits cannot be enforced, and the fake emails show up in Auth exports. |
| **B.** As A, but FastAPI proxies `accounts:signInWithPassword`, then mints a custom token | FastAPI calls the Identity Toolkit REST API | Partial. The email provider is still enabled, so direct REST calls **bypass** the lockout. Closing that needs Identity Platform blocking functions (Cloud Functions), which conflicts with "FastAPI only". | Good | Identity Platform upgrade + functions | Rejected |
| **C. (chosen)** FastAPI stores an **argon2id hash** in `credentials/{uid}`, verifies phone + password, and mints a Firebase **custom token**. The browser calls `signInWithCustomToken`. Firebase users have only the **phone** provider; email/password is disabled in the console. | FastAPI | **Yes:** per-account lockout and per-IP and per-phone windows in Firestore | Full: one generic error, role checked server-side, `wrong_role` only after a correct password | IAM `signBlob` permission for the Cloud Run service account (custom tokens) | **Chosen** |

Why C: it is the only option where FastAPI enforces lockout and rate limits for every password attempt. There is no second password store at Google, the Auth export contains no fake emails, and it keeps v2's tested behaviour: `LOGIN_LOCK` of 5 failures then 15 minutes, the generic message, and timing equalisation. Firebase still owns phone OTP (with reCAPTCHA), ID tokens, refresh tokens and revocation.

### 5.2 Token kinds

The `firebase.sign_in_provider` claim of the verified ID token gives two kinds of token:

| Kind | `sign_in_provider` | Obtained by | Accepted by |
|---|---|---|---|
| **Session token** | `custom` | `signInWithCustomToken(customToken)` after `/auth/login`, a signup or a reset | Every authenticated endpoint |
| **Phone-proof token** | `phone` | `signInWithPhoneNumber` + `confirm(code)`, in a **separate** Firebase app instance named `"phone-proof"` so the main session is untouched | Only `/auth/phone/status`, `/auth/signup/*` and `/auth/password/reset` (as the Bearer), and `/me/phone` (as the `X-Phone-Proof` header). The token's `auth_time` must be ≤ 10 minutes old and `phone_number` must be present. |

`deps.get_current_user` rejects phone-proof tokens with 403 `password_login_required`. This enforces "daily login = phone + password": a stolen SIM alone cannot reach business APIs without going through password reset, and a reset revokes every session.

### 5.3 Flows

**Signup (any public role):**
1. The browser uses `phoneProofAuth = getAuth(initializeApp(cfg, "phone-proof"))` with an invisible `RecaptchaVerifier`, then `signInWithPhoneNumber(phoneProofAuth, "+91…")` and `confirmationResult.confirm(code)`. The result is `proofToken = await user.getIdToken()`.
2. It calls `POST /api/v1/auth/phone/status` with `Authorization: Bearer <proofToken>`. The response is `{ phone, registered, role, invite }`:
   - If `registered` is true, the UI shows "already registered — log in".
   - For a driver, a pending invite for that phone is returned.
3. It calls `POST /api/v1/auth/signup/{role}` with Bearer `proofToken` and the profile body plus password. FastAPI then:
   1. verifies the token (provider `phone`, fresh, phone in E.164 `+91`);
   2. in one transaction, `create`s `phoneIndex/{e164}` (which fails if taken → 409 `account_exists`), `users/{uid}`, `credentials/{uid}` and the role profile (plus `agencies/{agc_*}` for an agency, and the invite or link update for a driver);
   3. after commit, sets the custom claims `{role, agencyId?}` and calls `create_custom_token(uid)`;
   4. returns `201 { customToken, user: SessionUserDTO }`.

   If setting the claims fails after commit, the request still succeeds, because claims are derived data and are repaired on the next `/auth/login` (§5.5).
4. The browser calls `signInWithCustomToken(mainAuth, customToken)` and then `signOut(phoneProofAuth)`.

**Login:** `POST /api/v1/auth/login {role, phone, password}` (public):
1. Rate limits are checked.
2. `phoneIndex/{e164}` is loaded. If it is missing, argon2 runs against a dummy hash (timing) and the response is 401 `invalid_credentials`.
3. `credentials/{uid}` is loaded. If `lockedUntil` is in the future → 423 `account_locked` with `details.lockedUntil`.
4. The password is verified:
   - **Failure:** `failedCount++`. On the 5th failure, lock for 15 minutes. Respond 401.
   - **Success:** reset the counter. If `users.status == "disabled"` → 403 `account_disabled`. If `users.role != role` → 403 `wrong_role` with `details.role`.
5. If needed, the argon2 hash is rehashed with the current parameters.
6. Claims are synced if they drifted, `lastLoginAt` is set, and the response is `200 { customToken, user }`.

**Password reset:**
1. Phone proof, as in signup step 1.
2. `POST /auth/password/reset {password, confirmPassword}` with Bearer `proofToken`:
   - If there is no account for the uid or phone → 404 `account_not_found`. The caller has proven ownership of the phone, so revealing this is acceptable.
   - Otherwise the hash is updated, the lockout is cleared, and `users.sessionsValidAfter = now` is set.
   - `auth.revoke_refresh_tokens(uid)` is called.
   - The response is `{ customToken, user }`, so the user is signed in on this device.

**Change password** (session): `POST /me/password {currentPassword, password, confirmPassword}`. The current password is verified with the same lockout counters. Then the hash is updated, `sessionsValidAfter = now` is set, and refresh tokens are revoked. The response carries a new `customToken`, so this device stays signed in and **other devices are signed out**.

**Change phone** (session):
1. The browser proves the **new** phone in the `phone-proof` app instance. This creates or signs into a Firebase user `uid2` that has the new phone.
2. `POST /me/phone {currentPassword}` with header `X-Phone-Proof: <uid2 token>`. FastAPI:
   1. verifies the password;
   2. checks the proof token is fresh and that `uid2` has **no** `users` doc (otherwise 409 `phone_taken`);
   3. deletes the Auth user `uid2` (it was only a proof);
   4. calls `auth.update_user(uid, phone_number=new)`;
   5. in a transaction, moves `phoneIndex`, updates `users.phone` and the profile phone, and updates the denormalised phone on open bookings (customer) or drivers (link lists);
   6. revokes the other sessions and returns `{ customToken, user }`.
3. A notification is sent to the account.

**Logout:**
- On this device, the client calls `signOut()`.
- `POST /auth/logout {allDevices: false}` is optional and only writes an audit log.
- With `allDevices: true` it sets `sessionsValidAfter` and revokes refresh tokens.

**Admin bootstrap:** `python scripts/create_admin.py --phone +91… --name "…"`:
1. Prompts for a password.
2. Creates the Auth user (phone only), `users/{uid}` with `role = "admin"`, `credentials` and `phoneIndex`, and sets claims `{role: "admin"}`.
3. Admins log in through `/auth/login` with `role: "admin"` from the hidden `/admin/login` page.

There is no public admin signup.

**Orphans:** a phone-proof user who never completes signup becomes an Auth user without a `users` doc. The sweep deletes such users when they are older than 24 hours and have no `role` claim (§13.3).

### 5.4 Per-request verification (`deps.py`)

```python
async def get_current_user(authorization: str = Header(...), db=Depends(get_db), clock=Depends(get_clock)) -> CurrentUser:
    token = bearer(authorization)                       # 401 unauthenticated if missing/malformed
    claims = await fb_auth.verify_id_token(token)       # local signature check (cached certs), clock_skew_seconds=10
                                                        #   ExpiredIdTokenError → 401 token_expired; other → 401 unauthenticated
    if claims["firebase"]["sign_in_provider"] != "custom": raise AppError("password_login_required")
    user = await users_repo.get(claims["uid"])          # 1 Firestore read per request
    if not user: raise AppError("unauthenticated")
    if user.status == "disabled": raise AppError("account_disabled")
    if claims["auth_time"] < user.sessions_valid_after.timestamp(): raise AppError("session_revoked")
    return CurrentUser(uid=user.id, role=user.role, agency_id=user.agency_id, phone=user.phone, name=user.display_name)

def require_role(*roles: Role):            # Depends(require_role("agency")) → 403 forbidden otherwise
async def get_optional_user(...)           # public endpoints: None when no/invalid token (never raises)
async def require_phone_proof(...) -> PhoneProof   # provider == "phone", now - auth_time ≤ 600 s, phone_number present
```

- The role comes from **Firestore** (`users.role`), not from claims.
- Revocation uses `sessionsValidAfter` from the same `users` read, so there is no extra Auth API call per request.
- `check_revoked=True` is used only in `/auth/session`, where certainty matters more than latency.
- The agency-scoped user context includes `agency_id`.
- Driver-only endpoints that need an active agency link use `require_linked_driver`, which reads `drivers/{uid}`.

### 5.5 Custom claims

The claims are `{"role": "customer"|"agency"|"driver"|"admin", "agencyId": "agc_…"?, "v": 1}`, well under 1000 bytes. They are written at signup, at admin role changes and at login when they have drifted. The frontend reads them with `getIdTokenResult()` to route the user and choose a shell. They are never trusted alone by the backend.

### 5.6 Frontend integration (D1)

- `apps/web/src/lib/firebase/client.ts` initialises the main app with `browserLocalPersistence`, plus a lazily created `"phone-proof"` app.
- `AuthProvider` subscribes to `onIdTokenChanged`. It exposes `user`, `role` and `loading`, and fetches `GET /auth/session` once per sign-in to obtain `SessionUserDTO`.
- `http.ts`:
  - `const t = await auth.currentUser?.getIdToken()` is sent as `Authorization: Bearer t`.
  - On 401 `token_expired`, it calls `getIdToken(true)` and retries once.
  - On 401 `session_revoked` or `unauthenticated` with a user present, it calls `signOut()` and redirects to login.
  - `credentials: "omit"`, and the base URL is `NEXT_PUBLIC_API_BASE_URL`.
- Route protection:
  - Client layouts for `/customer`, `/agency`, `/driver` and `/admin` gate on `AuthProvider` (role from claims).
  - `proxy.ts` may read a **non-sensitive** `taki_role` hint cookie, which the client sets after sign-in and clears on sign-out, to redirect early. It is UX only, and FastAPI authorises everything.
  - No Server Component reads protected data.
- Dev OTP: in local dev with the Auth emulator, the OTP is not sent by SMS. The signup screen in `NEXT_PUBLIC_APP_ENV=local` reads it from the emulator REST API `GET {emulator}/emulator/v1/projects/{id}/verificationCodes` and shows it labelled **"Dev OTP"**. That keeps the v2 developer experience. In staging, Firebase **test phone numbers** are used.

### 5.7 Account states

`users.status` is `active` or `disabled`.
- Disabling, by an admin: `status = "disabled"`, `auth.update_user(disabled=True)`, `sessionsValidAfter = now` and `revoke_refresh_tokens`.
- Enabling reverses the first two.

### 5.8 Rate limits and lockout

Fixed windows are stored in `rateLimits/{sha256(bucket)}` as `{count, windowStart, expiresAt}` and incremented in a transaction (ported from v2). A breach returns 429 `rate_limited` with a `Retry-After` header and `details.retryAfterSeconds`. When `TRUST_PROXY_HEADERS=true`, the IP is the first entry of `X-Forwarded-For`; otherwise it is the socket peer.

| Bucket | Limit |
|---|---|
| `login:ip:{ip}` | 30 / 15 min |
| `login:phone:{e164}` | 10 / 15 min (plus the lockout of 5 consecutive failures → 15 min) |
| `phone-proof:uid:{uid}` (status, signup, reset) | 10 / h |
| `password:change:uid:{uid}` | 10 / h |
| `booking:create:uid:{uid}` | 30 / h |
| `payment:create:uid:{uid}` | 20 / h |
| `payment:verify:uid:{uid}` | 120 / h |
| `upload:uid:{uid}` | 60 / h |
| `maps:uid:{uid}` (geocode, reverse geocode) | 120 / h |
| `search:ip:{ip}` (guest search, trip detail) | 120 / h |
| `contact:ip:{ip}` | 5 / h |

Firebase phone OTP is additionally protected by reCAPTCHA and Firebase's own SMS quotas. Configure an **SMS region policy** that allows only `IN` (Firebase console, or `auth_set_sms_region_policy`).

---

## 6. Firestore data model

### 6.1 Conventions

- **Field names are camelCase in Firestore and JSON.** Python models use snake_case with `alias_generator=to_camel` and `populate_by_name=True`.
- **Timestamps are native Firestore `Timestamp`s** (tz-aware UTC `datetime`). The v2 ISO strings are dropped, because the database starts empty and TTL policies need Timestamps. The API emits ISO-8601 UTC with `Z`, for example `2026-11-20T04:30:00Z`.
- **Calendar dates** (`dob`, `shippingDate`, `periodThrough`) are `YYYY-MM-DD` strings in the **IST** calendar.
- **Money:** pricing is in integer **rupees**, rates in integer **paise**, payments in integer **paise**.
- **Ids:**
  - `<prefix>_<20 [a-z0-9]>` from `secrets.token_bytes`, base32-lowercased.
  - Prefixes: `agc` agency, `veh` vehicle, `trp` trip, `tev` trip event, `shp` shipment, `bev` booking event, `pay` payment (= Cashfree `order_id`), `rf` refund, `inv` invite, `fil` file, `ntf` notification, `stl` settlement, `job` job, `msg` contact message, `aud` audit.
  - Booking ids are `TAKI` + **8 digits** (customer-facing; widened from 6). A collision is retried inside the transaction.
  - User ids are Firebase uids, 1–128 characters of `[A-Za-z0-9]`; in practice 28.
- Every document has `id`, `createdAt` and `updatedAt`. Mutable aggregates (`trips`, `bookings`, `payments`, `shipments`, `agencies`, `drivers`, `vehicles`) also have `version: int`, incremented on every write.
- No `FieldValue` sentinels inside business transactions: every write is read-modify-write in the transaction. `SERVER_TIMESTAMP` is not used; time comes from the injected clock, so tests are deterministic.
- **PII:** identity document numbers are **never stored in full**. Only `numberMasked` and `numberHmac` (HMAC-SHA256 with `PII_HASH_KEY`) are stored. Phones are stored in E.164 because they are operational data.

### 6.2 Shared embedded types

```python
class GeoPoint(BaseModel):           # stored as Firestore GeoPoint-compatible map {lat, lng}
    lat: float; lng: float

class PlaceRef(BaseModel):           # a geocoded place (agency base, checkpoint, address)
    place_id: str                    # Google place_id (may be stored indefinitely per Maps ToS)
    name: str                        # short display name ("Hosur")
    formatted_address: str
    location: GeoPoint
    locality: str | None             # Google "locality"
    district: str | None             # administrative_area_level_3 ?? administrative_area_level_2
    state: StateCode                 # from administrative_area_level_1 short/long name → TN|KL|KA|TG|AP|… (service-checked)
    state_name: str
    pincode: str | None              # postal_code component when Google returns one
    geohash: str                     # precision 7, for display/debug only
    geocoded_at: datetime

class Address(BaseModel):            # shipment source/destination
    line1: str; line2: str | None; landmark: str | None
    pincode: str                     # as entered; ^[1-9][0-9]{5}$; NOT used for matching
    place: PlaceRef                  # authoritative location
    source: Literal["autocomplete", "current_location", "manual"]

class FileRef(BaseModel):
    file_id: str

class Actor(BaseModel):
    role: Literal["customer", "agency", "driver", "admin", "system"]; user_id: str | None

class VerificationState(BaseModel):
    status: Literal["not_submitted", "pending", "verified", "rejected", "suspended"]
    submitted_at: datetime | None; reviewed_at: datetime | None
    reviewed_by: str | None          # admin uid
    reason: str | None

class IdentityDocument(BaseModel):
    kind: Literal["aadhaar", "pan", "driving_license", "rc"]
    number_masked: str; number_hmac: str
    file: FileRef; back_file: FileRef | None
    valid_until: date | None         # DL / RC
    uploaded_at: datetime
```

### 6.3 Collections

Ownership: **B** = backend-only (every collection; the rules deny all clients). The "Owner" column below is the *business* owner used for authorisation.

| Collection | Doc id | Business owner | Purpose |
|---|---|---|---|
| `users` | uid | the user | Role, status, revocation, display data |
| `credentials` | uid | the user | Password hash and lockout (never projected) |
| `phoneIndex` | e164 | — | Uniqueness: one phone = one account |
| `customers` | uid | customer | Customer profile |
| `agencies` | `agc_*` | agency owner uid | Agency profile, verification, stats |
| `drivers` | uid | driver | Driver profile, documents, agency link, verification |
| `driverInvites` | `inv_*` | agency | Agency → phone invites |
| `vehicles` | `veh_*` | agency | Fleet, photos, RC |
| `registrationIndex` | normalised registration without spaces | agency | Uniqueness of vehicle registration |
| `schedules` | `driver:{uid}` / `vehicle:{veh}` | agency | Busy intervals; lock document for overlap checks |
| `trips` | `trp_*` | agency | Route, checkpoints, legs, capacity ledger, search keys |
| `trips/{id}/events` | `tev_*` | — | Append-only trip events |
| `shipments` | `shp_*` | customer | Parcel, addresses, receiver |
| `bookings` | `TAKI########` | customer + agency (+ driver once paid) | Booking state machines and denormalised list fields |
| `bookings/{id}/events` | `bev_*` | — | **Tracking events**: append-only, timestamped |
| `bookingSecrets` | bookingId | — | Encrypted pickup and delivery OTPs, attempt counters |
| `payments` | `pay_*` | customer | Payment attempts (one per Cashfree order) and refunds |
| `webhookEvents` | sha256(event key) | — | Webhook log and dedupe |
| `idempotencyKeys` | sha256(scope:uid:key) | — | Stored responses for replays (24 h TTL) |
| `reviews` | bookingId | customer | One review per delivered booking |
| `earnings` | bookingId | agency | Agency earning per delivered booking |
| `settlements` | `stl_*` | agency | Payout records written by admin |
| `notifications` | `ntf_*` | recipient uid | In-app notifications |
| `files` | `fil_*` | per `ownerType` | Storage object metadata |
| `jobs` | `job_*` | — | Outbox (refunds) |
| `rateLimits` | sha256(bucket) | — | Fixed windows (TTL) |
| `geocodeCache` | sha256(query) | — | Geocoding results (TTL 30 days) |
| `distanceCache` | sha256(o,d) | — | Route Matrix elements (TTL 30 days) |
| `contactMessages` | `msg_*` | — | Landing-page contact form |
| `auditLog` | `aud_*` | — | Admin and security actions |

### 6.4 Document shapes

Python model notation follows. Fields are camelCase in storage. `ts` means Firestore Timestamp.

```python
# users/{uid}
class UserDoc:
    id: str; role: Literal["customer","agency","driver","admin"]
    phone: str                         # E.164 "+919876543210"
    display_name: str
    status: Literal["active","disabled"]
    agency_id: str | None              # role == agency
    sessions_valid_after: ts           # tokens with auth_time < this are rejected (§5.4)
    last_login_at: ts | None; phone_verified_at: ts
    created_at: ts; updated_at: ts

# credentials/{uid}
class CredentialDoc:
    id: str; password_hash: str        # argon2id $argon2id$v=19$m=65536,t=3,p=2$…
    password_changed_at: ts; failed_count: int; locked_until: ts | None
    updated_at: ts

# phoneIndex/{e164}
class PhoneIndexDoc: id: str; uid: str; role: Role; created_at: ts

# customers/{uid}
class CustomerDoc:
    id: str; full_name: str; dob: str  # IST date, 18+ at signup
    phone: str; photo: FileRef | None
    stats: {bookings: int, delivered: int}
    created_at, updated_at, version

# agencies/{agc_*}
class AgencyDoc:
    id: str; owner_uid: str; owner_name: str
    agency_name: str; name_lower: str; search_tokens: list[str]   # public agency picker
    base: PlaceRef                     # replaces districtId (city/district picked via Places Autocomplete)
    states_covered: list[StateCode]; vehicle_count_range: VehicleCountRange
    phone: str; photo: FileRef | None
    identity_document: IdentityDocument | None    # aadhaar | pan | driving_license
    verification: VerificationState    # not_submitted → pending when photo + identity document present
    stats: {vehicles, drivers, rating_avg: float, rating_count, delivered}
    created_at, updated_at, version

# drivers/{uid}
class DriverDoc:
    id: str; full_name: str; phone: str; photo: FileRef | None
    license: IdentityDocument | None   # kind driving_license, valid_until required for verification
    aadhaar: IdentityDocument | None
    agency_link: DriverAgencyLink | None   # {agency_id, agency_name, status: pending|active|rejected|removed,
                                           #  via: invite|request, requested_at, decided_at, reason}
    availability: Literal["available","unavailable"]    # agency-controlled
    verification: VerificationState    # admin reviews licence + Aadhaar + photo
    stats: {rating_avg, rating_count, delivered}
    created_at, updated_at, version

# driverInvites/{inv_*}
class DriverInviteDoc:
    id, agency_id, agency_name, phone, full_name
    status: Literal["pending","accepted","revoked","expired"]; expires_at: ts (14 d); driver_id: str | None
    created_at, updated_at

# vehicles/{veh_*}
class VehicleDoc:
    id, agency_id, vehicle_class: VehicleClass, model_id: VehicleModelId | None, make_model: str
    registration_number: str           # normalised "TN 37 XX 4587"
    max_payload_kg: int; body_type: BodyType
    dimensions_ft: {length, width, height} | None
    accepted_goods: list[GoodsCategory]; handling_supported: list[SpecialHandling]
    photos: list[FileRef] (≤5); image_key: VehicleImageKey
    rc: IdentityDocument | None        # kind "rc"
    rc_verification: VerificationState # only enforced when REQUIRE_VEHICLE_RC_VERIFIED
    status: Literal["active","inactive","removed"]
    created_at, updated_at, version

# schedules/{driver:uid | vehicle:veh_*}
class ScheduleDoc:
    id, kind: Literal["driver","vehicle"], resource_id: str
    intervals: list[{trip_id, from_: ts, to: ts}]   # from = departure − 60 min, to = arrival + 60 min; past pruned on write
    updated_at

# trips/{trp_*}
class TripCheckpoint:
    index: int                         # 0 = origin, n-1 = destination
    place: PlaceRef
    service_radius_km: float           # 2..15, default 10: pickups/drops accepted within this radius
    km_from_origin: float              # from Routes legs (1 decimal)
    expected_arrival_at: ts | None     # None for origin
    expected_departure_at: ts | None   # None for destination
    actual_arrival_at: ts | None; actual_departure_at: ts | None

class TripLeg:                         # leg k = checkpoint k → k+1 (computed by Routes computeRoutes)
    index: int; distance_km: float; duration_min: int; polyline: str  # encoded polyline of the leg

class CapacityHold:                    # trip.holds[bookingId]
    kg: int; from_index: int; to_index: int     # occupies legs from_index .. to_index-1
    state: Literal["held","committed"]           # held = accepted & unpaid; committed = paid
    due_at: ts | None                            # held only; stops counting at due_at

class AdditionalCharge:
    code: str                          # slug, unique per trip ("loading", "handling", "toll")
    label: str                         # 2..40 chars
    amount_rupees: int                 # 0..5000
    basis: Literal["per_booking","special_handling_only"]

class TripDoc:
    id, agency_id, agency_name
    vehicle_id; vehicle: {vehicle_class, make_model, registration_number, body_type, photo: FileRef|None, image_key}
    driver_id; driver: {full_name, photo: FileRef|None, rating_avg, rating_count}
    status: TripStatus                 # §7.5
    checkpoints: list[TripCheckpoint]  # 2..10
    legs: list[TripLeg]                # len = n-1; empty for drafts until previewed/published
    route: {distance_km, duration_min, overview_polyline: str, computed_at: ts, source: "google_routes"}
    departure_at: ts; arrival_at: ts   # = checkpoints[0].expected_departure_at / checkpoints[-1].expected_arrival_at
    capacity: {vehicle_max_kg: int, offered_kg: int}
    holds: dict[str, CapacityHold]     # THE capacity ledger (§8)
    capacity_summary: {committed_kg_max_leg: int, held_kg_max_leg: int, max_leg_load_kg: int}  # list views; recomputed on every hold write
    goods: {accepted: list[GoodsCategory], restricted_notes: str|None, handling_supported: list[SpecialHandling],
            max_package_kg: int|None, notes: str|None}
    rates: {per_km_paise: int, per_kg_paise: int}
    additional_charges: list[AdditionalCharge]   # ≤5 (replaces handlingFeeRupees)
    search_keys: list[str]             # "{gh4}|{YYYY-MM-DD}" (§9.2); empty unless published
    progress: {last_checkpoint_index: int|None, last_event_at: ts|None, next_step: {kind, index}|None}
    counts: {awaiting: int, held: int, committed: int, delivered: int}
    published_at, started_at, completed_at, cancelled_at: ts|None; cancel_reason: str|None
    created_at, updated_at, version

# trips/{id}/events/{tev_*}
class TripEventDoc:
    id, trip_id, type: Literal["published","started","checkpoint_arrived","checkpoint_departed","completed","cancelled","driver_reassigned"]
    checkpoint_index: int|None; at: ts; client_at: ts|None; actor: Actor; remarks: str|None

# shipments/{shp_*}
class ShipmentDoc:
    id, customer_id
    source: Address; destination: Address
    receiver: {name: str, phone: str}
    package: {weight_kg: int, goods_category, package_type, description, pieces: int,
              special_handling: list[SpecialHandling], declared_value_rupees: int|None}
    shipping_date: str                 # IST date
    status: ShipmentStatus             # §7.6
    current_booking_id: str | None     # the ONE non-terminal booking (duplicate guard)
    booking_ids: list[str]
    direct_distance_km: float          # haversine source→destination (display; validation ≥ 1 km)
    created_at, updated_at, version

# bookings/{TAKI########}
class BookingDoc:
    id, shipment_id, trip_id, customer_id, agency_id, driver_id, vehicle_id
    # ── four independent state machines (§7.1–§7.4) + closure ──
    approval_status: ApprovalStatus
    payment_status: BookingPaymentStatus
    reservation_status: ReservationStatus
    fulfilment_status: FulfilmentStatus
    closure: {kind: Literal["rejected","cancelled"], reason: CloseReason, note: str|None, at: ts, by: Actor} | None
    # ── derived, stored for queries (never written independently) ──
    status: BookingStatus              # legacy-compatible (§7.7)
    tab: CustomerTab; agency_tab: AgencyBookingTab; driver_tab: DriverShipmentTab | None
    # ── segment ──
    match_type: Literal["exact","intermediate"]
    pickup: {checkpoint_index, place_name, district, expected_departure_at: ts, distance_km: float}  # address→checkpoint
    drop:   {checkpoint_index, place_name, district, expected_arrival_at: ts, distance_km: float}
    weight_kg: int; goods_category; special_handling: list
    pricing: PricingBreakdown          # §9.4 (quoted at request, re-locked at accept)
    # ── deadlines and times ──
    respond_by: ts                     # pickup.expected_departure_at − 60 min
    accepted_at: ts|None; payment_due_at: ts|None; paid_at: ts|None; payment_id: str|None
    driver_assigned_at: ts|None        # = paid_at (booking becomes visible to the trip's driver)
    picked_up_at, delivered_at: ts|None
    status_history: list[{status, at, by: Actor, note?}]   # ≤ ~15 entries
    reviewed: bool
    display: {customer_name, customer_phone, receiver_name, agency_name, route_label, trip_departure_at, vehicle_reg, driver_name}
    search_tokens: list[str]           # agency History search
    created_at, updated_at, version

# bookings/{id}/events/{bev_*}   — TRACKING EVENTS
class BookingEventDoc:
    id, booking_id, type: TrackingEventType   # §13.1
    at: ts                             # server time (authoritative ordering)
    client_at: ts | None               # driver device time (audit only)
    actor: Actor
    checkpoint_index: int|None; place_name: str|None
    remarks: str|None; files: list[FileRef]
    visibility: list[Literal["customer","agency","driver"]]  # e.g. remarks visible to all three

# bookingSecrets/{bookingId}
class BookingSecretsDoc:
    id; pickup_otp_enc: str; delivery_otp_enc: str      # Fernet(OTP_ENC_KEY) ciphertext of 6 digits
    pickup_attempts: int; delivery_attempts: int
    pickup_used_at: ts|None; delivery_used_at: ts|None
    issued_at: ts; updated_at: ts

# payments/{pay_*}     (id == Cashfree order_id)
class PaymentDoc:
    id, booking_id, customer_id, agency_id
    provider: Literal["cashfree"]; provider_env: Literal["sandbox","production"]
    amount_paise: int; currency: Literal["INR"]
    status: PaymentStatus              # §7.8
    idempotency_key: str
    cf_order_status: str | None        # last seen order_status (ACTIVE/PAID/EXPIRED/TERMINATED)
    payment_session_id: str | None     # returned to the owner only while open
    expires_at: ts                     # order_expiry_time
    cf_payment_id: str | None; method_label: str | None   # masked ("UPI", "CARD ••4242")
    confirmation: {source: Literal["webhook","verify","reconcile"], at: ts, provider_status: str} | None
    failure_reason: str | None         # declined | user_dropped | expired | superseded | amount_mismatch | gateway_error
    refund: {refund_id, amount_paise, reason, status: Literal["pending","succeeded","failed"],
             requested_at, completed_at, cf_refund_id} | None
    attempts: list[{cf_payment_id, status, at, method_label}]   # ≤ 20, from webhooks/verify
    created_at, updated_at, version

# webhookEvents/{sha256(eventKey)}
class WebhookEventDoc:
    id; provider: "cashfree"; type: str          # PAYMENT_SUCCESS_WEBHOOK | …
    event_key: str                     # f"{type}:{order_id}:{cf_payment_id|refund_id}:{status}"
    order_id: str; payment_id: str | None
    raw_body_sha256: str; payload: dict          # verified JSON with customer_details stripped
    received_at: ts; processed_at: ts | None
    outcome: Literal["applied","duplicate","ignored","failed"]; error: str | None

# idempotencyKeys/{sha256(scope:uid:key)}
class IdempotencyDoc: id, scope, uid, request_hash, status: int, body: dict, created_at, expires_at (TTL)

# reviews/{bookingId}
class ReviewDoc: id, booking_id, customer_id, customer_first_name, driver_id, agency_id, trip_id, rating: 1..5, comment: str|None, created_at

# earnings/{bookingId}
class EarningDoc:
    id, booking_id, agency_id, trip_id, driver_id
    customer_paid: int; transportation_charge: int; additional_charges: int; platform_fee: int
    agency_net: int                    # transportation + additional
    route_label: str; delivered_at: ts
    status: Literal["pending","settled","on_hold"]; settlement_id: str|None; settled_at: ts|None
    created_at, updated_at

# settlements/{stl_*}
class SettlementDoc: id, agency_id, amount: int, earning_ids: list[str], reference: str (UTR), period_through: str, settled_at: ts, recorded_by: uid, created_at

# notifications/{ntf_*}
class NotificationDoc: id, user_id, role, kind: NotificationKind, title, body, link: {type, id}|None, created_at, read_at: ts|None

# files/{fil_*}
class FileDoc:
    id, owner_type: Literal["customer","agency","driver","vehicle","booking"], owner_id: str, uploaded_by: uid
    kind: Literal["profile_photo","aadhaar","pan","driving_license","rc","vehicle_photo","delivery_proof"]
    storage_path: str                  # §12.2
    content_type: Literal["image/jpeg","image/png","image/webp","application/pdf"]
    size_bytes: int; sha256: str
    status: Literal["active","replaced","deleted"]
    created_at, updated_at

# jobs/{job_*}
class JobDoc: id, type: Literal["refund","refund_status","delete_files"], payload: dict,
              status: Literal["pending","running","succeeded","failed"], attempts: int, next_attempt_at: ts, last_error: str|None, created_at, updated_at

# rateLimits / geocodeCache / distanceCache: {…, expires_at: ts}  (TTL policies on expiresAt)
# contactMessages/{msg_*}: name, phone|None, email|None, role, message, status: new|read|closed, ip_hash, created_at
# auditLog/{aud_*}: actor_uid, action ("agency.verify", "user.disable", "settlement.create", "refund.retry", "auth.logout_all"…), target {type,id}, data, at
```

### 6.5 Denormalisation and refresh rules

| Denormalised field | Source | Refreshed when |
|---|---|---|
| `trip.agencyName`, `booking.display.agencyName`, `driverInvites.agencyName`, `drivers.agencyLink.agencyName` | agency | Agency profile PATCH. The fan-out covers non-terminal trips, bookings and links, in batches of 400. |
| `trip.vehicle.*` | vehicle | Vehicle PATCH, for trips in `draft` / `published` only |
| `trip.driver.*`, `booking.display.driverName`, `booking.driverId` | driver / trip | Driver rename, trip reassign (open bookings) and review aggregates |
| `booking.display.customerName/customerPhone`, `display.receiverName` | customer / shipment | Customer rename or phone change (open bookings) |
| `agency.stats`, `driver.stats`, `customer.stats` | bookings / vehicles / drivers | Inside the transaction that changes them |
| `trip.capacitySummary`, `trip.counts` | `trip.holds` / bookings | Every hold or booking-state write |

---

## 7. State machines

All transitions live in the pure module `domain/booking_machine.py`. Services call:

```python
decide(booking, event, ctx) -> Decision(booking=new_booking, effects=[…])
```

The decision either succeeds or raises `AppError("invalid_transition", details={"event", "from"})`. Re-applying an event whose target state is already reached is a **no-op** with no effects. This idempotency rule is kept from v2.

### 7.1 `approvalStatus` (agency decision on the request)

```
pending ──accept──► accepted
   ├──reject──────► rejected
   ├──expire──────► expired          (now ≥ respondBy, system)
   └──withdraw────► withdrawn        (customer cancels before a decision, or trip cancelled while pending)
```

### 7.2 `paymentStatus` (booking-level aggregate; payment attempts have their own machine, §7.8)

```
not_due ──(accept)──► due ──order created──► processing ──verified PAID──► paid ──(pre-pickup cancel / refusal / trip cancel)──► refund_pending ──► refunded
                       ▲                         │                                                                      └──► refund_failed (admin retry → refund_pending)
                       │                         ├──declined / dropped──► failed ──new order──► processing
                       │                         └──order expired, window still open──► due
            due|processing|failed ──payment window closed──► expired
            not_due|due|processing|failed ──booking closed before payment──► voided
```

- `paid` is entered **only** by `payment_service.confirm_payment()` with `provider_status == PAID` and `amount == booking.pricing.totalPayable × 100`.
- A late or duplicate success never changes the booking. The *payment document* becomes `refund_pending` and a refund job is queued.

### 7.3 `reservationStatus` (capacity hold on the trip, §8)

```
none ──accept──► held (trip.holds[id] = {state: held, dueAt = paymentDueAt})
held ──paid──► committed (state: committed, dueAt: null)
held ──payment expired / customer cancel / trip cancel──► released   (hold deleted)
committed ──pre-pickup cancel / refuse pickup / trip cancel──► released
committed ──delivered──► consumed  (hold deleted: capacity of finished legs is irrelevant; history kept on the booking)
```

- A `held` hold stops counting at `dueAt`, even before the sweep runs.
- Starting a checkout extends `dueAt` to `max(dueAt, now + 15 min)`, capped at `pickup.expectedDepartureAt − 30 min`.

### 7.4 `fulfilmentStatus` (goods movement; driver actions)

```
not_started ──pickup (OTP, by assigned driver)──► picked_up ──depart checkpoint ≥ pickup (auto) / manual──► in_transit
   └──refuse pickup (driver, reason)──► pickup_refused                 in_transit ──arrive at drop checkpoint (auto) / manual──► out_for_delivery
                                                                      out_for_delivery ──deliver (OTP [+ photos])──► delivered
```

Guards:
- `pickup`: `paymentStatus == paid`; trip `published` or `in_progress`; `now ≥ pickup.expectedDepartureAt − 24 h`; OTP correct, with 5 attempts after which the customer must regenerate.
- `deliver`: OTP correct; proof photos are 0–3, and at least 1 when `REQUIRE_DELIVERY_PROOF=true`.

### 7.5 Trip `status`

| Event | From → To | Actor | Guards / effects |
|---|---|---|---|
| create | — → `draft` | agency | Any verification status except `suspended`. Places are geocoded and the route is computed if all stops are present. |
| update | `draft` | agency | Free edit. Changing stops recomputes the route. |
| update | `published` | agency | Safe fields only: rates, additional charges and package limit (apply to **new** requests); notes; `offeredKg` with `maxLegLoad ≤ offeredKg ≤ vehicleMax`. Route, times or vehicle need `counts.awaiting + counts.held + counts.committed == 0`, otherwise 409 `trip_has_bookings`. |
| publish | `draft` → `published` | agency | See the publish guards below. |
| unpublish | `published` → `draft` | agency | No awaiting, held or committed bookings. Clears search keys and schedule intervals. |
| reassign | `draft` / `published` | agency | New driver (and/or vehicle) passes the same checks plus a schedule transaction. Open bookings' `driverId` and display data are fanned out. No booking may be `picked_up` or later. Notifies the old and new driver and paid customers. |
| start | `published` → `in_progress` | driver | Implicit on **depart checkpoint 0**, allowed from `departureAt − 2 h`. Pending requests whose `respondBy` has passed are expired. |
| checkpoint arrive/depart | `in_progress` | driver | Order is enforced: arrive i → depart i → arrive i+1 (origin: depart only; destination: arrive only). Fan-out in §13.1. |
| complete | `in_progress` → `completed` | driver | Arrived at the destination, and every committed booking is `delivered` or closed. Schedule intervals are removed. |
| cancel | `draft` / `published` → `cancelled` | agency | No booking `picked_up` or later. Cascade (§7.1–7.3): pending → `withdrawn`; held or committed → released, with refunds queued. Schedule intervals are removed and everyone is notified. |

Publish guards:
- Agency `verified`; agency not `suspended`.
- Vehicle `active`, and its RC is present (`REQUIRE_VEHICLE_RC`) and verified (`REQUIRE_VEHICLE_RC_VERIFIED`).
- Driver link `active` and `available`, and driver `verified` (`REQUIRE_DRIVER_VERIFICATION`).
- 2–10 checkpoints, with times strictly monotonic (`trip_rules.checkpoint_issues`).
- Departure ≥ now + 60 min and ≤ now + 60 days.
- Route legs computed (Routes API; 503 `maps_not_configured` / 502 `maps_unavailable` otherwise).
- `offeredKg ≤ vehicle.maxPayloadKg`.
- **Driver and vehicle schedule free**, checked in a transaction (§8.3). On success the search keys and intervals are written.

### 7.6 Shipment `status`

```
open ──request──► requested ──payment confirmed──► booked ──pickup──► in_transit ──delivered──► delivered
requested|booked ──booking rejected/expired/withdrawn/cancelled/pickup_refused──► open   (currentBookingId = null)
open ──withdraw (customer)──► withdrawn
```

A shipment can be edited (PATCH) only while it is `open` and `currentBookingId == null`.

### 7.7 Derived legacy `status` and `tab` (`derive_status(b)`, first match wins)

| Condition | `status` | customer `tab` | agency `agencyTab` | driver `driverTab` |
|---|---|---|---|---|
| `closure.kind == "rejected"` (approval `rejected` / `expired`, or trip cancelled while pending) | `rejected` | `rejected` | `rejected` | — |
| `closure.kind == "cancelled"` | `cancelled` | `cancelled` | `cancelled` | `null` (the driver sees it only if it was paid) |
| approval `pending` | `awaiting_agency` | `pending` | `pending` | — |
| approval `accepted`, payment `due` / `processing` | `pending_payment` | `pending` | `accepted` | — |
| approval `accepted`, payment `failed` | `payment_failed` | `pending` | `accepted` | — |
| payment `paid`, fulfilment `not_started` | `confirmed` | `confirmed` | `confirmed` | `pending_pickup` |
| fulfilment `picked_up` | `picked_up` | `picked_up` | `confirmed` | `in_transit` |
| fulfilment `in_transit` / `out_for_delivery` | same | `in_transit` | `confirmed` | `in_transit` |
| fulfilment `delivered` | `delivered` | `delivered` | `confirmed` | `delivered` |

Close reasons (`closure.reason`):
- `rejected`: `agency_rejected`, `no_response_before_departure`, `trip_cancelled`.
- `cancelled`: `customer_cancelled`, `payment_window_expired`, `trip_cancelled`, `pickup_refused`.

**Combined transition table** (each row is one transaction):

| Event | Actor | approval | payment | reservation | fulfilment | closure / other effects |
|---|---|---|---|---|---|---|
| `request` | customer | → pending | not_due | none | not_started | Shipment → `requested`; `trip.counts.awaiting++`; event `requested`; notify the agency |
| `accept` | agency | pending → accepted | → due | → held | — | Capacity checked on the segment (409 `insufficient_capacity`); pricing re-locked; `paymentDueAt = min(now + 120 min, pickupDeparture − 30 min)`; notify the customer (driver name, photo, vehicle registration) |
| `reject` | agency | pending → rejected | → voided | — | — | closure rejected / `agency_rejected` (reason ≤ 300); shipment → `open`; notify |
| `expireRequest` | system | pending → expired | → voided | — | — | closure rejected / `no_response_before_departure`; shipment → `open`; notify both |
| `checkoutStarted` | customer | accepted | due / failed → processing | `dueAt` extended | — | — |
| `paymentFailed` | system (verified) | — | processing → failed | — | — | Notify the customer; the hold stays until `dueAt` |
| `paymentSucceeded` | system (verified) | accepted | processing / due / failed → paid | held → committed | — | `paidAt`, `driverAssignedAt`; `bookingSecrets` created (2 OTPs); shipment → `booked`; notify customer, agency and driver (`shipment_assigned`) |
| `expirePayment` | system | — | due / processing / failed → expired | held → released | — | closure cancelled / `payment_window_expired`; shipment → `open`; any open Cashfree order is terminated best-effort |
| `cancel` | customer | pending → withdrawn, or accepted | due / processing / failed → voided, or paid → refund_pending | held / committed → released | must be not_started | closure cancelled / `customer_cancelled`; refund job if paid (100 %; see open question 3) |
| `tripCancelled` | agency | pending → withdrawn, else unchanged | as cancel | released | not_started | closure rejected (if it was pending) or cancelled / `trip_cancelled`; refund if paid |
| `refusePickup` | driver | — | paid → refund_pending | committed → released | not_started → pickup_refused | closure cancelled / `pickup_refused`; full refund |
| `pickup` | driver | — | paid | committed | → picked_up | Shipment → `in_transit`; event; notify the customer |
| `startTransit` | system / driver | — | — | — | picked_up → in_transit | Event |
| `outForDelivery` | system / driver | — | — | — | in_transit → out_for_delivery | Notify the customer |
| `deliver` | driver | — | — | committed → consumed | → delivered | `earnings/{id}` created (`pending`); stats; shipment → `delivered`; notify customer and agency |
| `refundSucceeded` / `refundFailed` | system | — | refund_pending → refunded / refund_failed | — | — | Notify the customer; `refund_failed` goes to the admin queue |
| `review` | customer | — | — | — | delivered | `reviews/{id}`; rating aggregates; notify agency and driver |

### 7.8 Payment document `status` (one per Cashfree order; unchanged names, so the frontend `PublicPaymentStatus` keeps working)

`created` (doc written, order not yet created at Cashfree) → `pending` (order ACTIVE, session issued) → `succeeded` | `failed` | `cancelled` (superseded, expired or booking closed). Then `succeeded` → `refund_pending` → `refunded` | `refund_failed`.

At most **one** payment per booking is in `created` or `pending`.

### 7.9 Verification `status` (agency, driver, vehicle RC)

```
not_submitted ──required documents complete (auto)──► pending ──admin verify──► verified
                                                     └─admin reject (reason)──► rejected ──re-upload / resubmit──► pending
verified ──admin suspend (reason)──► suspended ──admin reinstate──► verified
```

- An agency needs a profile photo and one identity document (Aadhaar, PAN or DL).
- A driver needs a photo, a DL with `validUntil` ≥ today, and Aadhaar.
- A vehicle RC needs the RC document.
- Replacing a document while `verified` → 409 `already_verified`. An admin must reject or suspend first, so verified data cannot silently change.
- `DEV_AUTO_VERIFY` (local and test only) jumps from `pending` to `verified`.

Driver agency-link status is `pending | active | rejected | removed`, unchanged from v2.

---

## 8. Capacity, transactions and concurrency

### 8.1 Per-leg ledger (`domain/capacity.py`)

- Leg `k` is the stretch from checkpoint `k` to checkpoint `k+1`; a trip with `n` checkpoints has `n−1` legs.
- A hold from pickup `i` to drop `j` occupies legs `i..j−1`.

```python
def is_active(h, now): return h.state == "committed" or (h.due_at is not None and h.due_at > now)
def leg_loads(trip, now, exclude: str | None = None) -> list[int]       # Σ active kg per leg
def available_kg(trip, i, j, now, exclude=None) -> int                   # offered − max(leg_loads[i:j]); ≥ 0
def fits(trip, kg, i, j, now, exclude=None) -> bool
def invariant(trip, bookings, now) -> list[str]
#  - max(leg_loads) ≤ offeredKg ≤ vehicleMaxKg
#  - every hold ↔ a booking with reservationStatus in {held, committed}, same kg, same indices
#  - no booking with reservationStatus held/committed lacks a hold (except held with dueAt ≤ now awaiting sweep)
```

Search shows `availableCapacityKg = available_kg(trip, pickupIdx, dropIdx, now)`, which is the space left on the customer's own segment. The agency views show per-leg loads (`AgencyTripDTO.legs[].loadKg`).

### 8.2 Transactions (all in `services/*`, using `@firestore.async_transactional`, max 5 attempts)

Reads always come before writes. Firestore server-SDK transactions lock the documents they read pessimistically, so two concurrent accepts on one trip serialise. The loser retries, re-reads the holds, and fails with `insufficient_capacity`.

| Command | Reads (in the transaction) | Writes |
|---|---|---|
| `signup_*` | `phoneIndex/{e164}`, `users/{uid}`, (driver: invite, agency) | `phoneIndex` (create), `users`, `credentials`, profile, agency, invite or link, notification |
| `request_booking` | idempotency doc, shipment, trip, agency, customer, candidate booking id(s) | booking, booking event, shipment, `trip.counts`, notification, idempotency doc |
| `accept_booking` | booking, trip, agency, shipment | booking, trip (hold, counts, summary), event, notification |
| `reject_booking` / `expire_request` | booking, shipment, trip | booking, shipment, `trip.counts`, event, notification(s) |
| `create_payment_order` (phase 1) | idempotency doc, booking, trip, open payments of the booking | payment `created`, superseded payments → `cancelled`, booking (`processing`, hold `dueAt` extended), idempotency doc |
| `confirm_payment` | payment, booking, trip, shipment, other payments of the booking, `webhookEvents/{key}` (webhook source) | payment, booking, trip (hold → committed), shipment, `bookingSecrets`, events, notifications, webhook event; **or** a refund job for late or duplicate payments |
| `cancel_booking` / `refuse_pickup` | booking, trip, shipment, payment | booking, trip (hold deleted), shipment, payment (`refund_pending`), job, events, notifications |
| `pickup` / `deliver` | booking, `bookingSecrets`, trip, shipment, (agency, driver, customer for stats) | booking, secrets (attempts or used), events, shipment, notifications, (earning, stats) |
| `checkpoint_event` | trip, bookings on the trip with status in the open set (≤ 50) | trip (actual times, progress, status), trip event, affected bookings (auto transitions), booking events (fan-out), notifications |
| `publish_trip` / `reassign` / time edit | trip, agency, vehicle, driver, `schedules/driver:{id}`, `schedules/vehicle:{id}` (old and new on reassign) | trip, schedules, trip event |
| `cancel_trip` | trip, open bookings and their shipments and payments, schedules | trip, bookings, shipments, payments, jobs, events, notifications, schedules |
| `settle_agency` | earnings (`pending`, `deliveredAt ≤ through`, ≤ 400 per batch) | earnings → `settled`, settlement, notification, audit |

**Bounds:** `V3.maxOpenBookingsPerTrip = 50` keeps the trip-wide fan-out under the 500-writes-per-transaction limit, at about 4 writes per booking plus the trip. It is enforced in `request_booking` with 409 `trip_not_bookable`.

**Lazy expiry:** every transaction that loads a booking first runs `expire_if_due(booking, trip, now)` (request past `respondBy`; held hold past `dueAt` with no pending checkout in its 15-minute grace period). It applies the expiry in the same transaction. The requested action then fails with 410 `request_expired` / `payment_window_closed`, while the expiry still commits.

### 8.3 Conflicting vehicle and driver assignments

- `schedules/driver:{uid}` and `schedules/vehicle:{veh}` hold `intervals: [{tripId, from: departureAt − 60 min, to: arrivalAt + 60 min}]`.
- Publish, reassign and time edits on published trips **read both docs in the transaction**, so concurrent publishes for the same driver or vehicle serialise.
- An overlap returns 409 `driver_schedule_conflict` / `vehicle_schedule_conflict` with `details.conflictingTripId`.
- Cancel, unpublish and complete remove the interval. Past intervals are pruned on every write.
- A driver must also have an `active` link to the trip's agency, so two agencies cannot schedule the same driver.

### 8.4 Idempotency

- **`POST /customer/bookings` and `POST /payments/orders` require `Idempotency-Key`** (`^[A-Za-z0-9_.:-]{8,128}$`).
- `idempotencyKeys/{sha256(scope:uid:key)}` stores `{requestHash, status, body}` for 24 hours, inside the business transaction.
  - Same key and same body: the stored response is replayed (HTTP 200).
  - Same key with a different body: 422 `idempotency_key_reused`.
- **Natural-key guards:**
  - `shipment.currentBookingId` must be null, else 409 `shipment_has_open_booking` with `details.bookingId`.
  - Only one open payment per booking.
  - `order_id == paymentId`, so Cashfree deduplicates too.
- **Webhooks:** `webhookEvents/{sha256(eventKey)}` is `create`d in `confirm_payment`'s transaction. If it already exists, the response is 200 with `outcome = duplicate`.
- **State actions** (accept, reject, cancel, driver actions) are idempotent through the machine's "already in target state" rule.

### 8.5 Concurrency test plan (ported from v2 §6.6, against the emulator)

| # | Scenario | Expectation |
|---|---|---|
| T1 | A single-leg trip offering 1000 kg; 15 requests of 100 kg; `asyncio.gather` of 15 accepts | Exactly 10 accepted, 5 × `insufficient_capacity`; invariant holds |
| T1b | Legs A→B→C→D, 1000 kg; accept A→B 600, B→D 600, then A→D 500 | A→B and B→D both fit (disjoint legs); A→D fails |
| T2 | T1 with 5 concurrent customer cancels of accepted bookings | Holds = accepted − cancelled; invariant holds |
| T3 | Accept while another unpaid hold has just expired | Accept succeeds; the sweep later cancels the expired booking without touching the new hold |
| T4 | 10 concurrent requests with the same Idempotency-Key | 1 booking; 9 replays with the same id |
| T5 | 2 requests for the same shipment with different keys | 1 booking; 1 × 409 `shipment_has_open_booking` |
| T6 | Webhook and verify confirm the same payment concurrently | Booking paid once; 1 `bookingSecrets`; no duplicate notifications |
| T7 | A second order succeeds for an already-paid booking | Second payment `refund_pending` (`duplicate_payment`) and a job is queued |
| T8 | Success arrives after the payment window expired | Payment `refund_pending` (`late_payment`); booking stays cancelled |
| T9 | Two publishes for the same driver with overlapping times | 1 published, 1 × 409 `driver_schedule_conflict` |
| T10 | Seeded random interleaving (200 iterations) of request, accept, reject, cancel, pay, expire, pickup and deliver | `invariant()` is empty after every step |

---

## 9. Route matching, Maps and pricing

### 9.1 Server-side geocoding (D5 `integrations/maps`, called by D3 and D4 services)

**Shipment addresses:**
- The client sends `line1`, `pincode` and `state`, plus **one** of:
  - `placeId` (Places Autocomplete; the browser key);
  - `location {lat, lng}` (browser geolocation, after the user grants permission — "use current location");
  - `manual: true`.
- FastAPI resolves an authoritative `PlaceRef`:
  - `placeId` → Geocoding API `place_id=` lookup;
  - `location` → reverse geocode with `result_type=street_address|premise|route|sublocality|locality`;
  - manual → forward geocode of `"line1, line2, landmark, pincode, state, India"` with `components=country:IN`.
- Rejections:
  - no result → 422 `address_not_found`;
  - geocoded state ≠ declared `state` → 422 `address_state_mismatch`;
  - state not in `SERVICE_STATES` → 422 `outside_service_area`.
- The **pincode is validated by format only** (`^[1-9][0-9]{5}$`). It is stored and displayed, and **never used for matching**.
- `geocodeCache` holds results for 30 days, keyed by `sha256(placeId | rounded latlng | normalised query)`.

**Trip checkpoints:** the client sends `placeId` per stop. FastAPI geocodes each one, then calls **Routes API `computeRoutes`** (`POST https://routes.googleapis.com/directions/v2:computeRoutes`):
- origin = cp0, destination = cpN−1, `intermediates` = cp1..cpN−2 with `vehicleStopover: true`;
- `travelMode: DRIVE`, `routingPreference: TRAFFIC_UNAWARE`, `regionCode: "in"`, `units: METRIC`;
- `X-Goog-FieldMask: routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline`.

It stores `legs[]`, `route.overviewPolyline`, cumulative `kmFromOrigin` (1 decimal) and `durationMin`.
- The v2 ±30 % km override is removed; the road distance is authoritative.
- The agency still enters expected times. The preview proposes them from leg durations plus a dwell time (default 15 min per intermediate stop).
- **Nothing is approximated silently.** With Maps unavailable, preview and publish fail with 503 `maps_not_configured` / 502 `maps_unavailable`.

**Browser key (D1):**
- Places Autocomplete (New) with `includedRegionCodes: ["in"]`: address inputs use any type; checkpoint inputs use `locality | sublocality | administrative_area_level_3`.
- Maps JS draws the trip polyline (`google.maps.geometry.encoding.decodePath`) and checkpoint markers. Passed checkpoints are marked with their actual times. The map is labelled "Planned route" and shows **no live vehicle position**.

### 9.2 Search keys (written at publish, cleared at unpublish or cancel)

```python
keys = set()
for cp in checkpoints[:-1]:                                    # pickup-capable stops
    d = ist_date(cp.expected_departure_at)
    for cell in geohash_with_neighbours(cp.place.location, precision=4):   # 9 cells
        keys.add(f"{cell}|{d}")
trip.search_keys = sorted(keys)                                # ≤ 81 strings
```

- A geohash-4 cell is about 39 × 19.5 km. The 9-cell block covers every point within 19.5 km of the checkpoint, which is why `serviceRadiusKm` is capped at **15**.
- Search runs one indexed query: `trips.where(searchKeys array_contains f"{geohash4(source)}|{date}").where(status == "published").order_by(departureAt).limit(200)`.

### 9.3 Exact match (`domain/matching.py`; also re-run in `request_booking` and `accept_booking`)

For each candidate trip:

1. **Pickup candidates:** `i ∈ [0, n−2]` with `haversine(source, cp_i) ≤ cp_i.serviceRadiusKm`, `ist_date(cp_i.expectedDepartureAt) == date` (search only; booking requests skip the date check, as today) and `cp_i.actualDepartureAt is None`.
2. **Drop candidates:** `j ∈ [1, n−1]` with `haversine(destination, cp_j) ≤ cp_j.serviceRadiusKm`.
3. **Order check:** pick `(i, j)` with **`i < j`** minimising `d_i + d_j` (ties broken by the smallest `i`). If none exists → `not_on_route`.
   - `matchType = "exact"` when `i == 0 and j == n−1`, otherwise `"intermediate"`.
   - Source and destination near the **same** checkpoint never match. The shipment needs `directDistanceKm ≥ 1`.
4. **Time:** `now < respondBy = cp_i.expectedDepartureAt − 60 min`, else `departed`.
5. **Goods:**
   - `goodsCategory ∈ trip.goods.accepted`, else `goods_not_accepted`;
   - `temperature_sensitive` needs `handlingSupported`, else `handling_not_supported`;
   - `maxPackageKg is None or weightKg ≤ maxPackageKg`, else `package_too_heavy`.
6. **Capacity:** `available_kg(trip, i, j, now) ≥ weightKg`, else `insufficient_capacity`. This is counted in `excludedForCapacity`; restriction failures are counted in `excludedForRestrictions`.
7. **User filters:** `vehicleClass[]`, `minPrice` / `maxPrice`, `minCapacityKg`.
8. **Google road distances:**
   - For the ≤ 25 best survivors, call Routes **`computeRouteMatrix`** for source → each `cp_i` and each `cp_j` → destination.
   - Results are cached 30 days in `distanceCache` keyed by `sha256(round(lat,4), round(lng,4), placeId, direction)`.
   - They are returned as `pickup.distanceKm` / `drop.distanceKm` with `distanceSource: "road"`.
   - A trip is dropped when a road distance is greater than `serviceRadiusKm × 1.6`.
   - If the Matrix call fails, results are still returned with `distanceSource: "straight_line"`. Haversine between two real geocoded points is not fabricated data, and the UI labels it "approx. straight-line".

Sorting (`price_asc` default, `price_desc`, `departure_asc`, `arrival_asc`; ties broken by price, rating desc, trip id) and badges (`best_price` > `top_rated` > `more_capacity`, only with ≥ 2 results) are unchanged from `src/lib/domain/matching.ts`. The server returns at most 100 results, uncursored.

### 9.4 Pricing v3 (`domain/pricing.py`, ported from `quoteV2`)

```
segmentKm            = cp_j.kmFromOrigin − cp_i.kmFromOrigin            (Google road km)
distanceCharge       = roundHalfUp(segmentKm × perKmPaise)              integer rupees
weightCharge         = roundHalfUp(weightKg × perKgPaise)
transportationCharge = distanceCharge + weightCharge
additional           = Σ c.amountRupees for c in trip.additionalCharges
                         if c.basis == "per_booking" or (c.basis == "special_handling_only" and specialHandling)
serviceFee           = serviceFeeFor(weightKg)   # ≤500 kg ₹350, ≤1000 ₹500, ≤2000 ₹750, else ₹1000
totalPayable         = transportationCharge + additional + serviceFee
agencyNet            = transportationCharge + additional                 # platform keeps serviceFee
```

`PricingBreakdown` (pricingVersion **3**) has the fields above plus `lines[]`:
- `{code: "distance", …}`, `{code: "weight", …}`
- one `{code: "additional", label: c.label, amount}` per applied charge
- `{code: "service_fee", …}`

`totalPayable == Σ lines.amount` always.

The quote is computed at request and **re-locked at accept** from the trip's current rates; a change is shown in the acceptance notification. The amount charged is always `booking.pricing.totalPayable × 100` paise, read server-side.

---

## 10. Cashfree payment flow (D5)

### 10.1 Configuration

- `CashfreeClient` is built only if `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` and `CASHFREE_ENV` are all set. Otherwise `get_cashfree()` raises 501 `payments_not_configured` for orders, status-verify and history-with-verify. The webhook returns 501 `webhook_not_configured`, which Cashfree will retry.
- Base URL: `https://sandbox.cashfree.com/pg` or `https://api.cashfree.com/pg`.
- Headers: `x-client-id`, `x-client-secret`, `x-api-version: CASHFREE_API_VERSION`, `x-request-id: <request id>`, `x-idempotency-key: <paymentId>` on POSTs.
- `httpx.AsyncClient` with a 10 s timeout and no automatic retries on POST. GETs are retried twice on 5xx or timeout.
- Logs carry only status and Cashfree error code; never secrets or PII.

### 10.2 Create order

```
Browser                    FastAPI                                   Firestore                  Cashfree
  │ POST /payments/orders {bookingId}  (Bearer, Idempotency-Key)
  │──────────────────────────►│ tx1: idempotency? booking owner? expire_if_due
  │                           │      booking.approval==accepted && payment in {due, failed, processing}
  │                           │      reuse open payment if pending & not expired → return it (reused=true)
  │                           │      else supersede open payments (→cancelled), create payments/{pay_x} status=created,
  │                           │      amount = pricing.totalPayable*100, expiresAt = min(paymentDueAt, now+30min) (≥ now+15min, Cashfree min)
  │                           │      booking.paymentStatus → processing; hold.dueAt = max(dueAt, now+15min) (capped)
  │                           │──────────────────────────────────────────►│ commit
  │                           │ POST /orders {order_id: pay_x, order_amount: 1234.00, order_currency: INR,
  │                           │   customer_details{customer_id: uid, customer_phone: 10 digits, customer_name},
  │                           │   order_meta{return_url: APP_ORIGIN/customer/payment/return?paymentId={order_id},
  │                           │              notify_url: PUBLIC_API_BASE_URL/api/v1/payments/cashfree/webhook},
  │                           │   order_expiry_time: ISO+05:30, order_tags{bookingId}} ─────────────────────────────►│
  │                           │◄──────────────────────── {payment_session_id, order_status: ACTIVE} ────────────────│
  │                           │ tx2: payment status created→pending, paymentSessionId, cfOrderStatus
  │◄── 201 {paymentId, amountRupees, expiresAt, checkout{kind:"cashfree", mode, paymentSessionId, orderId}}
  │ cashfree.js: load({mode}).checkout({paymentSessionId, redirectTarget:"_self"})
```

- If `POST /orders` fails or times out, tx2 marks the payment `failed` with `failureReason = gateway_error`, sets the booking's `paymentStatus` back to `due` (or `failed` if a previous attempt failed), and returns 502 `gateway_error`.
- If Cashfree says the order already exists (409, a retried call), FastAPI does `GET /orders/{id}` and continues.

### 10.3 Return and verify

1. Cashfree redirects to `APP_ORIGIN/customer/payment/return?paymentId=pay_x`.
2. The page calls `POST /payments/{paymentId}/verify`, then polls `GET /payments/{paymentId}` every 3 s for up to 60 s.
3. Verify calls `GET /orders/{id}`, and `GET /orders/{id}/payments` when the order is `PAID` or `ACTIVE`, then runs `confirm_payment(source = "verify")`:

| Cashfree order status | Result |
|---|---|
| `PAID` | A `SUCCESS` payment with `payment_amount × 100 == amountPaise` → `succeeded`. A differing amount → payment `failed` (`amount_mismatch`) plus an alert log; the booking is not confirmed. |
| `ACTIVE`, latest payment `FAILED` / `USER_DROPPED` / `CANCELLED` | Payment `failed` (`declined` / `user_dropped`); booking `paymentStatus` → `failed` |
| `ACTIVE`, no terminal payment | Stays `pending` |
| `EXPIRED` / `TERMINATED` | Payment `cancelled` (`expired`); booking `paymentStatus` → `due` if the window is still open |

**Nothing the browser sends can mark a payment paid.** The return URL only triggers a server-side lookup.

### 10.4 Webhook

```
Cashfree ──POST /api/v1/payments/cashfree/webhook (raw body, x-webhook-signature, x-webhook-timestamp, x-webhook-version)──► FastAPI
  1. raw = await request.body()  (bytes, never re-serialised)
  2. expected = base64(HMAC_SHA256(CASHFREE_SECRET_KEY, timestamp + raw)); hmac.compare_digest → else 401 invalid_signature
  3. |now − timestamp(ms or s)| ≤ 300 s → else 401 stale_timestamp
  4. parse: PAYMENT_SUCCESS_WEBHOOK | PAYMENT_FAILED_WEBHOOK | PAYMENT_USER_DROPPED_WEBHOOK | REFUND_STATUS_WEBHOOK
     (unknown types → 200 {"ok":true,"outcome":"ignored"}, logged in webhookEvents)
  5. eventKey = f"{type}:{order_id}:{cf_payment_id|refund_id}:{status}"
  6. payment events: **re-fetch the order from Cashfree** (GET /orders/{id}) and pass the fetched status to
     confirm_payment(source="webhook", eventKey) — the webhook is a trigger; the API answer is the truth
     (defends against a leaked-secret replay of an old body and against out-of-order events)
  7. refund events: apply_refund_result(refund_id, status) idempotently
  8. respond 200 {"ok": true, "outcome": "applied"|"duplicate"|"ignored"} within 2 s
     (on internal error → 500 so Cashfree retries; the dedupe doc is only written in the successful tx)
```

### 10.5 `confirm_payment(payment_id, result, source, event_key=None)` — the single confirmation path

One transaction does the following:

1. **Dedupe.** If `event_key` is set, `webhookEvents.create`; if the event exists, stop with outcome `duplicate`.
2. **Terminal payments are a no-op.** If the payment is already `succeeded`, `refund_*`, `failed` or `cancelled`, return.
   - Exception: a late success after a payment was marked failed or cancelled is still processed as a success, then refunded.
3. **`failed` / `expired` result:** update the payment. If the booking's `paymentId` is this payment, set the booking's `paymentStatus` → `failed` or `due`.
4. **`paid` result:** set the payment to `succeeded` with `cfPaymentId`, `methodLabel` and `confirmation`. Then:
   - The booking is still payable (approval `accepted`, payment not `paid`, no closure, hold active or re-fittable) → `booking_service.apply_payment_result(tx, booking, paid)`. That sets hold → committed, `paymentStatus = paid`, `paidAt`, `driverAssignedAt`, OTPs, shipment `booked`, events and notifications. Other open payments of the booking become `cancelled` (superseded).
   - The booking is already paid by another payment → refund this one (`duplicate_payment`).
   - The booking is closed or expired, or the hold expired and capacity no longer fits → refund (`late_payment`) and notify the customer.
5. **Refund:**
   - Payment → `refund_pending` with `refund = {refundId: "rf_" + paymentId[4:], amountPaise, reason}`.
   - A `refund` job is enqueued and run after commit: `POST /orders/{id}/refunds {refund_amount, refund_id, refund_note}`.
   - The job polls `GET /orders/{id}/refunds/{refund_id}`, or the `REFUND_STATUS_WEBHOOK` arrives, and the payment goes `refunded` or `refund_failed`.
   - The booking's `paymentStatus` mirrors this for the booking's own payment.

### 10.6 Failure handling summary

| Situation | Behaviour |
|---|---|
| No credentials | 501 `payments_not_configured`. The booking stays `pending_payment` until the window expires, and the UI shows "Online payments are not configured". |
| Gateway down at create | 502 `gateway_error`. The payment is `failed` (`gateway_error`) and the customer can retry. |
| User closes checkout | The order stays ACTIVE. Verify or the webhook marks `failed` / `user_dropped`. Retry creates a new order and supersedes the old one. |
| Window expires while pending | The sweep runs `expire_payment` unless a payment is younger than the 15-minute grace period. A later success is refunded as `late_payment`. |
| Webhook lost | Return-page verify plus the sweep's reconcile (pending > 10 min) |
| Amount mismatch | Never confirm. Payment `failed` (`amount_mismatch`), ERROR log, admin payments view |
| Refund fails 8 times | `refund_failed` goes to the admin queue (`GET /admin/payments?status=refund_failed`). An admin can retry. |

**Payment history:**
- Customer: `GET /payments/history` (all attempts, newest first).
- Agency: `/agency/earnings.payments` (succeeded and refunded only).
- Admin: `GET /admin/payments`.

---

## 11. Firestore indexes (`firebase/firestore.indexes.json`, owner D3)

| Collection | Fields | Used by |
|---|---|---|
| trips | `searchKeys` CONTAINS, `status` ASC, `departureAt` ASC | customer search / offers |
| trips | `agencyId` ASC, `status` ASC, `departureAt` DESC | agency trips tabs, dashboard |
| trips | `agencyId` ASC, `departureAt` DESC | agency history (trips) |
| trips | `driverId` ASC, `status` ASC, `departureAt` ASC | driver trips and dashboard |
| trips | `vehicleId` ASC, `status` ASC, `departureAt` ASC | vehicle active-trip guard |
| bookings | `customerId` ASC, `tab` ASC, `updatedAt` DESC | customer tabs |
| bookings | `customerId` ASC, `updatedAt` DESC | customer dashboard and all |
| bookings | `agencyId` ASC, `agencyTab` ASC, `createdAt` DESC | agency bookings tabs |
| bookings | `agencyId` ASC, `tripId` ASC, `createdAt` DESC | agency bookings for a trip |
| bookings | `agencyId` ASC, `createdAt` DESC | agency history |
| bookings | `agencyId` ASC, `searchTokens` CONTAINS, `createdAt` DESC | agency history search |
| bookings | `tripId` ASC, `status` ASC | trip fan-out (`status in [...]`) |
| bookings | `driverId` ASC, `driverTab` ASC, `updatedAt` DESC | driver shipment tabs |
| bookings | `driverId` ASC, `status` ASC, `deliveredAt` DESC | driver history |
| bookings | `approvalStatus` ASC, `respondBy` ASC | sweep: expire requests |
| bookings | `reservationStatus` ASC, `paymentDueAt` ASC | sweep: expire payment windows |
| bookings | `customerId` ASC, `driverId` ASC | file access (driver photo) |
| bookings | `customerId` ASC, `agencyId` ASC | file access (agency/customer photo) |
| shipments | `customerId` ASC, `status` ASC, `createdAt` DESC | open shipments |
| payments | `customerId` ASC, `createdAt` DESC | customer history |
| payments | `agencyId` ASC, `createdAt` DESC | agency earnings: payments |
| payments | `bookingId` ASC, `createdAt` DESC | booking attempts |
| payments | `status` ASC, `updatedAt` ASC | sweep reconcile; admin queues |
| notifications | `userId` ASC, `createdAt` DESC | list |
| notifications | `userId` ASC, `readAt` ASC | unread count |
| reviews | `driverId` ASC, `createdAt` DESC | driver reviews |
| reviews | `agencyId` ASC, `createdAt` DESC | agency reviews |
| earnings | `agencyId` ASC, `status` ASC, `deliveredAt` DESC | earnings, settlement batches |
| earnings | `agencyId` ASC, `deliveredAt` DESC | earnings by month |
| earnings | `status` ASC, `deliveredAt` ASC | admin settlements overview |
| settlements | `agencyId` ASC, `settledAt` DESC | agency and admin history |
| vehicles | `agencyId` ASC, `status` ASC, `createdAt` DESC | vehicles list |
| vehicles | `rcVerification.status` ASC, `createdAt` DESC | admin RC queue |
| drivers | `agencyLink.agencyId` ASC, `agencyLink.status` ASC, `fullName` ASC | agency drivers |
| drivers | `verification.status` ASC, `createdAt` DESC | admin driver queue |
| agencies | `verification.status` ASC, `createdAt` DESC | admin agency queue |
| agencies | `verification.status` ASC, `searchTokens` CONTAINS, `nameLower` ASC | public agency picker |
| driverInvites | `agencyId` ASC, `status` ASC, `createdAt` DESC | agency invites |
| driverInvites | `phone` ASC, `status` ASC | invite lookup at signup |
| jobs | `status` ASC, `nextAttemptAt` ASC | job runner |

**Field overrides:** indexing is disabled on `bookings.{statusHistory,pricing,display}`, `trips.{checkpoints,legs,route,holds}`, `payments.attempts`, `webhookEvents.payload` and `geocodeCache.result`.

**TTL policies** on `expiresAt`: `rateLimits`, `idempotencyKeys`, `geocodeCache`, `distanceCache`. Expiry is always enforced in code as well.

---

## 12. Security model

### 12.1 Firestore rules: deny all (`firebase/firestore.rules`)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }   // FastAPI (Admin SDK) only
  }
}
```

The frontend never needs a direct read: notifications are polled every 30 s and tracking is fetched on demand. A future realtime opening would be limited to `notifications` where `request.auth.uid == resource.data.userId`; it is not in v3.

### 12.2 Storage

**Paths:**
- `users/{uid}/profile_photo/{fileId}.{ext}`
- `users/{uid}/identity/{aadhaar|pan|driving_license}/{fileId}.{ext}`. For agency documents, `uid` is the owner's uid.
- `agencies/{agencyId}/vehicles/{vehicleId}/{photos|rc}/{fileId}.{ext}`
- `bookings/{bookingId}/delivery_proof/{fileId}.{ext}`

**`firebase/storage.rules`** (defence in depth; FastAPI does every read and write with the Admin SDK):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{uid}/{allPaths=**} {
      allow read: if request.auth != null && (request.auth.uid == uid || request.auth.token.role == "admin");
      allow write: if false;
    }
    match /{allPaths=**} {
      allow read: if request.auth != null && request.auth.token.role == "admin";
      allow write: if false;
    }
  }
}
```

**Uploads:**
- Multipart to FastAPI; the request limit is 20 MB.
- Identity documents and RC: 5 MB, JPEG, PNG, WEBP or PDF.
- Photos: 5 MB, JPEG, PNG or WEBP.
- Delivery proof: 8 MB each, at most 3.
- The type is checked by **magic bytes**. Client MIME types and names are ignored.
- Images are re-encoded with Pillow to strip EXIF (GPS).
- A replaced file becomes `status = replaced`, and a `delete_files` job deletes its bytes after 30 days.

**Downloads through signed content URLs:**
- DTOs carry `{fileId, url}` with `url = {PUBLIC_API_BASE_URL}/api/v1/files/{fileId}/content?exp={unix}&v={viewerUid}&sig={b64url(HMAC_SHA256(FILE_URL_SECRET, f"{fileId}|{viewerUid}|{exp}"))}`.
- The URL is valid for 60 minutes and is minted by `views/*` **only after** `file_service.can_read(viewer, file)` has passed.
- The content endpoint verifies `sig` and `exp`, re-checks that the file is `active`, and streams with `Cache-Control: private, max-age=300`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'`.
- This works identically on the emulator and in production, needs no IAM `signBlob`, and lets `<img src>` work without an `Authorization` header.
- `GET /files/{fileId}` (Bearer) re-authorises and returns a fresh URL.

**`can_read(viewer, file)`** (ported from `src/server/files/access.ts`; admin can read everything):

| Kind | Readers |
|---|---|
| `aadhaar`, `pan`, `driving_license` | Owner; for driver documents, the agency with a `pending` or `active` link. **Never customers.** |
| `rc` | Owning agency; the driver of a published or in-progress trip using the vehicle |
| `profile_photo` (driver) | Driver; linked agency; customers whose booking on the driver's trip has approval `accepted` |
| `profile_photo` (agency) | Owner; linked drivers; customers with any booking with the agency |
| `profile_photo` (customer) | Owner; agencies with a booking from the customer; the driver of a paid booking |
| `vehicle_photo` | Any authenticated user. Guests see `imageKey` illustrations instead. |
| `delivery_proof` | The booking's customer, agency and driver |

**Masked numbers:**
- Aadhaar `XXXX XXXX 1234`
- PAN `XXXXXX234F`
- DL and RC: everything except the last 4 replaced with `X`

Full numbers are never stored or returned. Reuse of the same document across accounts is flagged to admins by matching `numberHmac`.

### 12.3 Contact and PII projection rules (`views/*`)

| Data | Customer (owner) | Agency | Driver (assigned) |
|---|---|---|---|
| Place names, district, weight, goods, description, date | yes | yes, from request | yes, once paid |
| Full addresses (`line1`, `line2`, landmark, pincode, coordinates) | yes | from `accepted` | once paid |
| Customer name | yes | from request | once paid |
| Customer phone | yes | from `accepted` | once paid, until delivered or closed (then `null`) |
| Receiver name and phone | yes | once paid | once paid, until delivered or closed (then `null`) |
| Driver name, photo, rating; vehicle registration | rating at search; the rest from `accepted` | yes | self |
| Driver phone | once paid, until delivered | yes (own drivers) | self |
| Pricing breakdown | yes | yes | no (weight and pieces only) |
| Pickup and delivery OTPs (decrypted) | once paid, until used | **no** | **no** (enters them) |
| Identity documents | no | own, plus linked drivers' (masked) | own |
| Delivery proof | yes | yes | yes |

Each projection has a unit test asserting the absent fields for every role × status combination.

### 12.4 Other controls

- **CORS:** allow-list from `CORS_ALLOWED_ORIGINS`, `allow_credentials=False`, methods `GET POST PUT PATCH DELETE`, headers `Authorization, Content-Type, Idempotency-Key, X-Phone-Proof, X-Request-ID`. `X-Request-ID` and `Retry-After` are exposed.
- **API headers:** `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- **Logs** never contain tokens, passwords, OTPs, document numbers or full phone numbers. A scrubber redacts the keys `authorization`, `password`, `otp`, `x-client-secret`, `x-phone-proof`, `aadhaar` and `number`, and phones are masked.
- Admin and security actions are written to `auditLog`.
- Secrets come only from Secret Manager. `.env.example` holds placeholders.

---

## 13. Tracking, notifications and background work

### 13.1 Tracking events (`bookings/{id}/events`)

**Types:** `requested`, `accepted`, `rejected`, `expired`, `payment_started`, `payment_succeeded`, `payment_failed`, `confirmed`, `driver_assigned`, `driver_reassigned`, `cancelled`, `picked_up`, `in_transit`, `checkpoint_arrived`, `checkpoint_departed`, `out_for_delivery`, `delivered`, `delivery_proof_added`, `refund_started`, `refunded`, `remark`.

- **Checkpoint fan-out:** a driver arrive or depart at checkpoint `k` writes the trip event **and** a `checkpoint_*` event on every paid booking with `pickup.index ≤ k ≤ drop.index`, in the same transaction. It also applies the automatic transitions:
  - depart `k ≥ pickup.index`: `picked_up` → `in_transit`;
  - arrive `k == drop.index`: `in_transit` → `out_for_delivery`, notify `out_for_delivery`;
  - arrive at an intermediate `k`: notify `checkpoint_reached`.

  Every role reads the same ordered, timestamped list, so status stays synchronised.
- `at` is server time and is used for ordering. `clientAt` is device time (audit only); the UI shows "recorded at" when they differ by more than 10 minutes.
- **Customer `TrackingDTO` stages are unchanged:** Booking → Confirmation → Pickup → In transit → checkpoints strictly between pickup and drop (expected vs actual) → Out for delivery → Delivered (proof, remarks). A terminal row is added for rejected and cancelled bookings.
- The route map shows the planned polyline and checkpoints. **`liveLocation` is always `null`.**

### 13.2 Notifications

- In-app only. They are written inside the business transaction by `notification_service.notify(tx, …)`.
- The kinds are the v2 `NotificationKind` list plus `refund_completed`, `driver_reassigned`, `vehicle_rc_verified`, `vehicle_rc_rejected`, `agency_suspended`, `driver_verified`, `driver_rejected` and `password_changed`.
- The v2 recipient matrix (v2 §10) applies.
- The client polls `unread-count` every 30 s while visible.
- **No SMS or push in v3.** FCM can be added behind `notification_service` later without API changes.
- Driver invites send no SMS. The invite shows up after phone verification at signup (`/auth/phone/status`).

### 13.3 Sweep (`POST /api/v1/internal/sweep`)

**Auth:** a Google-signed OIDC token with `aud == SWEEP_OIDC_AUDIENCE` and email in `SWEEP_INVOKER_EMAILS`, or `Bearer CRON_SECRET`. Cloud Scheduler runs it every 5 minutes. Steps run in bounded batches, each isolated:
1. Expire requests: `approvalStatus == pending`, `respondBy ≤ now`.
2. Expire payment windows: `reservationStatus == held`, `paymentDueAt ≤ now` (respecting the checkout grace period).
3. Reconcile `payments.status == pending` older than 10 minutes through `GET /orders/{id}`, with `confirm_payment(source = "reconcile")`.
4. Run due jobs (refund, refund_status, delete_files). Backoff: 1, 5, 15, 60, 60, 60, 60, 60 minutes, then `failed`.
5. Expire `driverInvites` past `expiresAt`.
6. Delete orphan Auth users: no `role` claim, no `users` doc, created more than 24 hours ago, at most 1000 per run.

After-commit work also runs immediately through FastAPI `BackgroundTasks`. **Correctness never depends on the sweep.**

---

## 14. API conventions (full detail in the contract)

- **Base:** `/api/v1`, JSON (multipart where marked), camelCase.
- **Lists:** `{items, nextCursor}`, with `limit` (default 20, max 50) and an opaque `cursor`. Bounded lists return `{items}` and are marked in the contract.
- **Time:**
  - Instants are UTC ISO-8601 `Z` in output. Inputs must carry an offset.
  - Date-only fields use the IST calendar.
  - "Today", the 18+ check, search dates, `month` filters and "this month" all use `Asia/Kolkata`.
  - The frontend renders every time with `timeZone: "Asia/Kolkata"`.
- **Not found:** a malformed path id, or a resource that is missing or not visible, returns 404 `not_found`. A wrong role returns 403 `forbidden`.
- **OpenAPI:** `/api/v1/openapi.json` always; `/api/v1/docs` only when `APP_ENV != production`.

---

## 15. Testing strategy (Python)

### 15.1 Tooling

- `pytest` with `pytest-asyncio` (mode auto) and `httpx.AsyncClient(transport=ASGITransport(app=app))`.
- Time comes from the injected `FrozenClock`.
- `respx` mocks outbound HTTP in unit tests.
- `coverage` with ≥ 85 % on `domain/` and `services/`.
- `ruff`, `mypy --strict`, `import-linter`.

### 15.2 Layers

| Layer | Emulator? | Covers |
|---|---|---|
| `tests/unit/domain/**` | no | Four booking machines and `derive_status`; per-leg capacity and invariant; pricing v3 (lines sum, rounding); matching (radius, order i<j, exact vs intermediate, date, departed, goods, capacity, sort, badges); geohash keys; trip rules; Verhoeff, PAN, DL and RC; phone; registration |
| `tests/unit/integrations/**` | no | Cashfree signature (golden vectors, ms and s timestamps), event parsing, client against `respx`; Maps parsing (geocode components → `PlaceRef`, routes legs) |
| `tests/integration/**` | **yes** (Auth + Firestore + Storage) | Every endpoint through ASGI: authN/authZ matrix (anonymous, phone-proof token, wrong role, other owner, owner, admin, disabled, revoked); validation and error envelope; projections (no PII leak); rate limits and lockout; idempotency; uploads (magic bytes, EXIF stripped); signed file URLs; webhooks; the T1–T10 concurrency suite |
| Playwright (D1) | yes, plus `uvicorn` and `next dev` | Customer, agency, driver and admin journeys, with FakeMaps and FakeCashfree (test flag below) |

### 15.3 Emulator fixtures

- Run with `firebase emulators:exec --only auth,firestore,storage --project demo-taki "uv run pytest backend/tests"`.
- An autouse fixture clears data before each test:
  - `DELETE /emulator/v1/projects/demo-taki/databases/(default)/documents` (Firestore)
  - `DELETE /emulator/v1/projects/demo-taki/accounts` (Auth)
  - Storage: delete the bucket objects.
- `tests/support/tokens.py`:
  - `session_token(uid)`: `auth.create_custom_token`, then emulator `POST /identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key` returns an `idToken`.
  - `phone_proof_token(phone)`: `accounts:sendVerificationCode`, then `GET /emulator/v1/projects/demo-taki/verificationCodes`, then `accounts:signInWithPhoneNumber`.
- `tests/support/builders.py` creates agencies, drivers, vehicles, trips and bookings **through the services**. No hand-written documents, except in invariant-violation tests.

### 15.4 Fakes (`app/tests_support/`, injected via `app.dependency_overrides`)

- **`FakeMaps`:**
  - a deterministic gazetteer of about 40 real places (Coimbatore, Tiruppur, Erode, Salem, Namakkal, Krishnagiri, Hosur, Bengaluru, Vellore, Chennai, Madurai, Tiruchirappalli, Kochi, Thrissur, Palakkad, Mysuru, Hyderabad, Vijayawada, …) with true coordinates and components;
  - routes and matrix computed as haversine × 1.25 at 55 km/h;
  - a switch to simulate `maps_unavailable`.
- **`FakeCashfree`:**
  - in-memory orders and `session_<id>`;
  - tests drive outcomes with `mark_paid(order_id, amount_rupees)`, `mark_failed`, `mark_dropped` and `expire`;
  - `signed_webhook(event_type, order_id, …)` returns a body and headers signed with the test secret;
  - refunds settle on the next fetch.
- **The fakes are not a payment simulator in the product.** They answer *as Cashfree would*, and the app path that requires verified confirmation is unchanged. The boot guard honours `TAKI_TEST_FAKES=1` only when `APP_ENV in {local, test}` and an emulator host is set. `import-linter` forbids importing `tests_support` from `app/**` except in `deps.py`'s guarded factory.

### 15.5 CI

- **`backend.yml`:** Ubuntu, Python 3.12 (uv), Node 22 (firebase-tools), Java 21. Steps: ruff, mypy, lint-imports, unit tests, emulator integration tests, Docker build.
- **`web.yml`:** `npm ci`, eslint, `tsc`, vitest, `next build`, contract check (§15.6).
- **`deploy.yml`** (manual or tag, Workload Identity Federation):
  1. build and push to Artifact Registry
  2. `gcloud run deploy`
  3. `firebase deploy --only firestore:rules,firestore:indexes,storage`
  4. App Hosting rollout

### 15.6 Contract drift check

CI dumps `openapi.json` (`python -m app.openapi_dump`) and runs `openapi-typescript`. D1's `apps/web/src/lib/api/contracts/__contract__.test-d.ts` asserts with `satisfies` that the hand-written TS DTOs match the generated types. Any drift fails the build.

---

## 16. Docker and Cloud Run (D5)

```dockerfile
# backend/Dockerfile
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
RUN useradd --uid 10001 --create-home taki
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER taki
EXPOSE 8080
CMD ["sh","-c","exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 20"]
```

**Main dependencies:** `fastapi`, `uvicorn[standard]`, `pydantic>=2.9`, `pydantic-settings`, `firebase-admin>=6.6`, `google-cloud-firestore`, `httpx`, `argon2-cffi`, `cryptography`, `pillow`, `python-multipart`, `python-geohash` (or a vendored 40-line implementation), `google-auth`. Dev: `pytest`, `pytest-asyncio`, `respx`, `ruff`, `mypy`, `import-linter`, `coverage`.

**Cloud Run:**
- `asia-south1`; 1 vCPU / 512 Mi; concurrency 40; min instances 1 in production; max 10; timeout 60 s.
- Custom domain `api.<domain>`. Startup probe `/api/v1/health`.
- Secrets mounted from Secret Manager.

**Runtime service account `taki-api@`:**
- `roles/datastore.user`
- `roles/firebaseauth.admin`
- `roles/storage.objectAdmin` (bucket)
- `roles/iam.serviceAccountTokenCreator` **on itself** (required by `create_custom_token` on Cloud Run)
- `roles/secretmanager.secretAccessor`
- `roles/logging.logWriter`

**Cloud Scheduler:** job `taki-sweep`, `*/5 * * * *`, POST with an OIDC token of `taki-scheduler@` (`roles/run.invoker`).

**Firebase console:**
- Phone provider ON, email/password OFF.
- SMS region policy allow-list `IN`.
- Authorised domains = the App Hosting domains.
- Firestore native mode and Storage bucket, both in `asia-south1`, on the Blaze plan.

**Frontend:** Firebase App Hosting backend rooted at `apps/web` (`apphosting.yaml` with the §4.2 env).

**Local dev** (`scripts/dev.ps1` / `.sh`; Java 21 required):
1. `firebase emulators:start --only auth,firestore,storage --project demo-taki --import .data/emulators --export-on-exit`
2. `uv run uvicorn app.main:app --reload --port 8000` (from `backend/`)
3. `npm --prefix apps/web run dev` (Next rewrites `/api/v1/*` → `:8000`)

---

## 17. Migration and deletion plan

1. **Day 0** (one commit, owners in parallel). Every service function signature is published with a `not_implemented` body so routers can be built in parallel.
   - D2: `main.py`, `core/*`, `deps.py`, middleware, error catalog, health, Firebase integration.
   - D3: `models/*`, `repositories/base.py`, collections, rules, indexes.
   - D4 and D5: pure domain modules and integration protocols.
2. **Wave 1:** routers, services and tests per owner against the emulator, with fakes for Maps and Cashfree.
3. **Wave 2 (D1):**
   - `git mv` the frontend to `apps/web`.
   - New `http.ts` (base URL plus Bearer, retry on `token_expired`), `AuthProvider`, phone-OTP screens (signup, reset, change phone), Places Autocomplete address and checkpoint inputs, route map, Cashfree JS checkout and return page.
   - Switch every client module to `/api/v1` per the contract's "Replaces" column.
   - Delete the dev-gateway page.
4. **Wave 3:** E2E with fakes; then staging with Cashfree sandbox and real Maps.
5. **Delete:**
   - `apps/web/src/server/**`, `apps/web/src/app/api/**`;
   - the server-only domain files (`booking-machine`, `capacity`, `matching`, `segments`, `places/*`, `pricing` — keep only UI formatting helpers);
   - the npm packages `firebase-admin`, `server-only`, `tsx`, the TS seed and ops scripts, and `vitest.emulator.config.mts`.

   A CI grep fails if any `route.ts` exists under `apps/web/src/app/api` or `firebase-admin` is imported.

---

## 18. File ownership (backend/app and repo)

| Agent | Owns |
|---|---|
| **D2 — FastAPI core, auth, users/profile, admin** | `app/{main.py,deps.py}`, `core/**`, `middleware/**`, `api/v1/router.py`, `routers/{health,meta,auth,me,public,files,admin}.py`, `schemas/{common,errors,auth,profile,admin}.py`, `models/{base,enums,user,file,misc}.py`, `domain/{documents,phone}.py`, `services/{auth_service,profile_service,admin_service,file_service}.py`, `views/{common,admin}.py`, `integrations/firebase/**`, `repositories/{users,files,rate_limits,idempotency,audit,contact}.py`, `scripts/create_admin.py`, `tests/support/{tokens,emulator,app}.py`, `tests/**/{core,auth,profile,admin,files}/**` |
| **D3 — Firestore data layer, agency, vehicles, drivers, trips** | `repositories/{base,collections,agencies,drivers,invites,vehicles,schedules,trips,earnings,settlements,jobs,caches}.py`, `models/{agency,driver,vehicle,trip,earning,job}.py`, `domain/{capacity,trip_rules,vehicles,geo}.py`, `services/{agency_service,vehicle_service,driver_mgmt_service,trip_service,earnings_service}.py`, `routers/{agency_profile,agency_vehicles,agency_drivers,agency_trips,agency_history,agency_earnings,agency_dashboard,driver_profile}.py`, `schemas/agency.py`, `views/agency.py`, `firebase/**`, `scripts/check_invariants.py`, `tests/support/builders.py`, `tests/**/{agency,vehicles,drivers,trips,capacity}/**` |
| **D4 — shipments, matching, bookings, tracking, notifications, reviews** | `models/{shipment,booking,notification,review}.py`, `repositories/{shipments,bookings,booking_secrets,events,notifications,reviews}.py`, `domain/{booking_machine,matching,pricing}.py`, `services/{shipment_service,search_service,booking_service,tracking_service,notification_service,sweep_service}.py`, `routers/{customer_shipments,customer_search,customer_bookings,customer_dashboard,agency_bookings,driver_app,driver_trips,driver_shipments,notifications,reviews,internal}.py`, `schemas/{customer,driver,notifications}.py`, `views/{customer,driver}.py`, `tests/**/{customer,bookings,matching,tracking,concurrency,sweep}/**` |
| **D5 — Cashfree, Google Maps, Docker, Cloud Run, CI** | `integrations/{cashfree,maps}/**`, `models/payment.py`, `repositories/{payments,webhook_events}.py`, `services/{payment_service,jobs_service}.py`, `routers/{payments,maps}.py`, `schemas/{payments,maps}.py`, `app/tests_support/**`, `backend/{Dockerfile,pyproject.toml,uv.lock,.env.example}`, `.github/workflows/**`, `scripts/dev.*`, `docs/v3/deploy.md`, `tests/**/{payments,maps,integrations}/**` |
| **D1 — Next.js frontend** | `apps/web/**`: the move, `http.ts`, `lib/firebase/**`, `AuthProvider`, auth screens, Places and map components, Cashfree checkout, client modules → `/api/v1`, `apphosting.yaml`, contract `satisfies` test, Playwright |

**Boundaries:**
- **Booking state changes only in D4's `booking_service` / `tracking_service`.**
  - D3's trip cancel and reassign call `booking_service.close_for_trip_cancel(tx, …)` / `booking_service.fan_out_driver(tx, …)`.
  - D5's `confirm_payment` calls `booking_service.apply_payment_result(tx, …)` and `booking_service.apply_refund_result(tx, …)`.
  - D2's admin refund retry calls `payment_service.retry_refund`.
- **Capacity math lives only in D3's `domain/capacity.py`.** D4 calls it inside its transactions.
- **Maps lives only in D5's `integrations/maps`.** D3 (trip route) and D4 (addresses, matrix) call `get_maps()`.
- **Shared files change only through their owner** (SendMessage with the exact diff): `core/errors.py`, `models/enums.py`, `schemas/common.py` (D2); `firestore.indexes.json` (D3); `pyproject.toml` (D5).

---

## 19. Open questions for the owner

1. **Vehicle RC review:** `REQUIRE_VEHICLE_RC_VERIFIED=false` by default (RC upload is required, admin review optional). Must every RC be admin-verified before publishing?
2. **Capacity at request time:** capacity is reserved at **acceptance** (workflow step 10), so rejection normally has nothing to release. Should a request tentatively hold capacity until `respondBy`? That would block other customers for hours.
3. **Cancellation fees:** pre-pickup cancellation refunds 100 % (v2 behaviour). Any fee after acceptance or close to pickup?
4. **GST:** not itemised on quotes or settlements. This needs a decision before production payouts.
5. **Google Maps ToS:** place_ids are stored indefinitely, and coordinates and polylines are kept on trips and in caches with a 30-day TTL. Confirm against the owner's Maps Platform agreement.
6. **Service radius:** default 10 km, agency-adjustable 2–15 km per checkpoint. Adequate for rural pickups?
7. **Delivery proof photo:** optional by default (`REQUIRE_DELIVERY_PROOF=false`, per "OTP + optional photo"). Confirm.
8. **Service area:** `SERVICE_STATES` = TN, KL, KA, TG, AP. Keep?
9. **Logout:** Firebase cannot revoke a single device, so "Log out" is local and "Log out everywhere" revokes all sessions. Acceptable?
10. **SMS cost and abuse:** phone OTP is billed per SMS on Blaze. reCAPTCHA plus the `IN`-only region policy are on; enable App Check later?
11. **Driver verification gate:** `REQUIRE_DRIVER_VERIFICATION=true` means a driver can be assigned only after admin verification of licence and Aadhaar (stricter than v2). Confirm.
