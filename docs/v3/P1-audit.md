# P1 — Repository audit for the FastAPI monorepo migration

Branch `feat/fastapi-monorepo` (created from `feat/marketplace` @ `a9d555e`). Audit date 2026-11-15. Every statement below was checked against the code. Paths are relative to the repo root (`D:\urgent`).

**TL;DR**
- **Backend size:** `src/server/**` is 85 files and 11,297 lines of TypeScript. `src/app/api/**` holds **102 `route.ts` files that export 120 handlers**, plus one helper (`payments/cashfree/_lib/cashfree-server.ts`). All of this moves to FastAPI.
- **Clean HTTP boundary:** the frontend reaches the backend only through `src/lib/api/http.ts` (same-origin `fetch('/api/...')`, cookies, JSON error envelope).
  - No page, layout or feature imports `@/server`. The single exception is **`src/proxy.ts`**, which imports `@/server/auth/session-cookie` to verify the cookie HMAC.
  - No server component reads Firestore. All 58 pages are thin wrappers around `"use client"` views.
- **Auth is entirely custom** (no Firebase Auth today): scrypt passwords, a server OTP with HMAC'd codes, proof tokens, an HMAC-signed `taki_session` cookie and revocable `sessions/{sha256(sid)}` docs. The owner's target (Firebase phone OTP for signup and reset, phone + password for daily login) replaces `otpChallenges`, the SMS providers and the proof tokens. It does **not** replace the password and session layer: Firebase Auth has no "phone + password" sign-in.
- **What is real and what is simulated:**
  - Simulated: maps (illustrative SVG, no live location), district coordinates (approximate HQ lat/lng), distance (curated table or haversine × 1.25), and dev payments (explicit Approve/Decline page).
  - Real but untested against live services: Cashfree (create order, get order, webhook, refunds) and MSG91.
  - Simulated in dev: SMS (code shown on screen; fixed OTPs when `DEV_FIXED_OTPS=true`).
- **Tests:** 217 vitest cases in 28 files (all run against TS server code through an in-memory DocStore) and about 144 Playwright tests in 13 specs.
  - E2E helpers depend on **seeded demo accounts and seeded trips**, which conflicts with the "empty database" decision.
  - `integration.spec.ts`, `visual.spec.ts` and most of `responsive-a11y.spec.ts` are still v1 (localStorage `taki-demo-v1`).

---

## 1. Inventory

### 1.1 Top level

| Path | What | Tracked in git | Notes |
|---|---|---|---|
| `src/` | Next.js app + TS backend | yes | see below |
| `tests/` | `unit/` (vitest), `e2e/` (Playwright), `support/` | yes | |
| `scripts/` | `e2e.mjs`, `seed.ts`, `ops.ts`, `sweep.ts`, `shot.mjs`, `seed/assets/sample-{doc,photo}.png` | yes | |
| `docs/` | `DEMO_LOGINS.md`, `backend-integration.md` (**stale v1**), `components.md`, `planning/` (v1 specs + `v2/`), `qa/` | yes | |
| `public/assets/taki/` | 30 runtime images: `branding/7`, `cargo/4`, `elements/5`, `hero/4`, `ui/2`, `vehicles/8` (3.0 MB) | yes | Served by Next; `vehicleImageSrc()` points at `vehicles/*.webp` |
| `TAKI_website_assets/TAKI_website_assets/` | Brand kit (logos, favicons, palette, `taki-colors.css`, README) (1.8 MB) | yes | Design source, not loaded at runtime |
| `TAKI_Website_Images_Original_Logo/TAKI_Website_Assets/` | Original logo + images (3.8 MB) | yes | Design source |
| `references/` | `Reference.jpeg` + `screens/` (16 files, 4.5 MB) | yes | UI reference screenshots |
| `Reference.jpeg` | 372 KB root copy of the main reference | yes | Duplicate of `references/Reference.jpeg` |
| `test-results/` | 301 MB on disk; **46 files tracked** (`test-results/visual/*.png`, modified in working tree) | partly | `.gitignore` keeps `test-results/*` out except `visual/` |
| `.data/` | Emulator export + `seed-accounts.txt` | no (`.gitignore`) | |
| `.agents/`, `.claude/` | Agent skills (992 tracked files) | yes | Eslint ignores them; not app code |
| `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules` | Firebase config | yes | → `firebase/` |
| `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `next-env.d.ts` | Next config | yes (`next-env.d.ts` ignored) | |
| `playwright.config.ts`, `vitest.config.mts`, `vitest.emulator.config.mts` | Test config | yes | |
| `.env.example`, `.env.development` (committed, no secrets), `.env.local` (secrets: `SESSION_SECRET`, `PII_HASH_KEY`, `CRON_SECRET`) | env | example + development | |
| `firestore-debug.log` (160 KB) | Emulator log | no | |
| `AGENTS.md` | Next 16 notice (rewritten by `next dev`) | yes | |
| `skills-lock.json` | Agent skills lock | yes | |

### 1.2 `package.json`

- **Name / runtime:** `taki-travel`; Node ≥ 22 (README).
- **Dependencies:** `next 16.4.6`, `react 19.3.0`, `react-dom 19.3.0`, `firebase-admin ^14.5.1`, `zod ^4.6.7`, `react-hook-form ^7.91`, `@hookform/resolvers ^7`, `lucide-react ^1.71`, `clsx`, `tailwind-merge`, `server-only`.
  - `@cashfreepayments/cashfree-js ^1.0.7` is **unused**: `src/features/payment/cashfree-checkout.ts` loads `https://sdk.cashfree.com/js/v3/cashfree.js` itself.
- **devDependencies:** `@playwright/test ^1.65`, `@axe-core/playwright`, `vitest ^5.1`, `tailwindcss 4.3.3`, `@tailwindcss/turbopack 4.3.3`, `firebase-tools ^15.36`, `tsx`, `typescript ^5`, `eslint ^9`, `eslint-config-next 16.4.6`, `@types/*`.

**Scripts**

| Script | Command | Fate |
|---|---|---|
| `dev` / `build` / `start` / `lint` / `typecheck` | next / eslint / tsc | stay in `apps/web` |
| `test` / `test:watch` | `vitest run` (`tests/unit/**`) | most suites test TS server code → port to pytest, then delete |
| `test:e2e` | `node scripts/e2e.mjs` → `firebase emulators:exec … "playwright test"` | keep, re-target |
| `test:e2e:build` | `next build` | keep |
| `check` | typecheck + lint + test | keep (web only) |
| `emulators` | `firebase emulators:start --only firestore,storage --project demo-taki --import=.data/emulators --export-on-exit` | move to `firebase/` + add `auth` emulator |
| `seed` | `tsx --conditions=react-server … scripts/seed.ts` | **delete** (empty-DB decision); keep only an admin bootstrap |
| `ops` | `tsx … scripts/ops.ts` | port to a Python CLI (`backend/app/cli`) |
| `sweep` | `tsx … scripts/sweep.ts` | port (Cloud Scheduler → `/internal/sweep`) |
| `test:emulator` | `firebase emulators:exec … vitest --config vitest.emulator.config.mts` | replace with pytest + emulator |
| `rules:deploy` | `firebase deploy --only firestore:rules,firestore:indexes,storage` | move to `firebase/` / CI |

### 1.3 TypeScript / Next config

- **`tsconfig.json`:** single alias `@/*` → `./src/*`; `strict`, `moduleResolution: bundler`; includes `**/*.ts(x)` and `**/*.mts`, so tests and scripts are type-checked too.
- **`next.config.ts` (CRLF):**
  - `reactStrictMode`, `poweredByHeader: false`.
  - Security headers on `/:path*`: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.cashfree.com; object-src 'none'`, and `Permissions-Policy` (camera/geolocation/payment self).
  - **Six temporary redirects** `/driver/{routes,routes/new,routes/new/pricing,bookings,earnings,help}` → `/agency/...`.
  - `images.formats` avif/webp; `turbopack.rules` for Tailwind. `cacheComponents` is off.
  - There are **no rewrites** today: `/api` is served by Next itself.
- **`src/proxy.ts`** (the Next 16 replacement for middleware):
  - Matcher: `/customer/:path*`, `/agency/:path*`, `/driver/:path*`, `/admin/:path*`, `/auth/login`, `/signup/:path*`.
  - Verifies the cookie HMAC, role and expiry with **no DB call**. It redirects signed-in users away from auth pages, sends wrong-role users to their dashboard, and sends guests to `loginFor(role, next)`. It clears stale cookies.
  - Guest-public paths: `/customer`, `/customer/dashboard`, `/customer/vehicles`, `/customer/booking/*`, `/admin/login`.
  - Imports `readCookie`, `verifySessionCookie` and `clearedSessionCookie` from `src/server/auth/session-cookie.ts`, which is Web Crypto only and has no `server-only` marker.
- **`src/instrumentation.ts`:** on the Node runtime it calls `checkStartupEnv()` (refuses `DEV_FIXED_OTPS` in production). In dev it warns when the Firestore emulator is unreachable. It is backend-only and is **deleted with `src/server`**.
- **`eslint.config.mjs` (CRLF):** next core-web-vitals + typescript; ignores `.agents`, `.claude`, `references`, both TAKI asset folders, `playwright-report` and `test-results`.

### 1.4 Firebase

| File | Content |
|---|---|
| `firebase.json` | firestore rules/indexes; storage rules; emulators firestore `127.0.0.1:8080`, storage `:9199`, UI `:4000`, `singleProjectMode`. **No auth emulator configured.** |
| `.firebaserc` | default project `demo-taki` |
| `firestore.rules` | `allow read, write: if false` everywhere (Admin SDK only) |
| `storage.rules` | `allow read, write: if false` everywhere (files are served through `/api/files/[fileId]`) |
| `firestore.indexes.json` | **39 composite indexes + 9 field overrides** (see §2.10) |

### 1.5 Test configs

- **`vitest.config.mts`:** `tests/unit/**/*.test.ts`, node env, alias `@` → `src`, `server-only` → Next's empty module.
- **`vitest.emulator.config.mts`:** re-runs `tests/unit/server/core/**` and `tests/unit/server/payments/**` against the emulator (`TAKI_TEST_STORE=emulator`, serial, 120 s timeouts).
- **`playwright.config.ts`:**
  - `testDir: tests/e2e`; global setup `tests/support/e2e-global-setup.ts` runs **`npm run seed -- --reset`**.
  - `webServer`: `npx next start -p 3100` with `TAKI_E2E=1`, emulator hosts, `SMS_PROVIDER=dev`, `PAYMENT_PROVIDER=dev`, and secrets from `.env.local`.
  - Projects: desktop 1440, laptop 1280, tablet 768, mobile 390, small 360. Locale `en-IN`, timezone `Asia/Kolkata`.
- **`scripts/e2e.mjs`:** requires `.next/BUILD_ID` and wraps Playwright in `firebase emulators:exec` (needs Java).

### 1.6 Scripts

| Script | Purpose | Backend imports |
|---|---|---|
| `scripts/seed.ts` | Guarded dev dataset (emulator only, or `--allow-remote` + `SEED_ALLOW_REMOTE=1`, never `FIREBASE_PROD_PROJECT_ID`). Writes `.data/seed-accounts.txt`. **The only way an admin user is created today.** | `@/server/seed`, `@/server/firebase/admin` |
| `scripts/ops.ts` | `agency:verify/reject`, `driver:verify/reject`, `settle`, `settlements:pending`, `check-invariants`, `jobs:retry`, `user:disable` | `@/server/core/*`, `@/server/auth/sessions` |
| `scripts/sweep.ts` | One-off `runSweep(now)` | `@/server/core/sweep` |
| `scripts/shot.mjs` | Dev screenshot helper. Injects a **v1 localStorage demo session** (`--as customer\|driver`), so it is stale. | — |
| `scripts/e2e.mjs` | See §1.5 | — |

### 1.7 Line endings

- There is no `.gitattributes`, and `core.autocrlf=false`.
- Outside `.agents/` and `.claude/`, **91 tracked files are CRLF**, including `package.json`, `next.config.ts`, `README.md`, 18 files in `src/server`, 8 test files and many `src/features` and `src/components` files.
- `src/server/auth/guards.ts` is **mixed**.
- Repo-wide count including skill folders: 792 CRLF files.

---

## 2. Backend to port (`src/server/**`, `src/app/api/**`)

### 2.1 Architecture as it is today

```
route.ts ──handler(spec, fn)──► modules/<role>/*.ts ──► core/*.ts (all cross-role transitions)
              │                        │                     │
              │                        └──► views/*.ts (Doc → DTO projections)
              └── auth/guards (cookie → sessions → users), http/{origin,rate-limit,idempotency,errors}
db/DocStore (Firestore-shaped interface) ─► FirestoreDocStore (firebase-admin) | MemoryDocStore (tests/support)
files/FileStore ─► Firebase Storage | MemoryFileStore (tests)
payments/gateway ─► dev | cashfree        auth/sms ─► dev | msg91
```

**Transaction conventions** (Python must keep all of these):
1. All reads happen before the first write (`ReadAfterWriteError`).
2. There are no `FieldValue` sentinels: every mutation is read-modify-write.
3. Timestamps are ISO-8601 UTC **strings**. TTL collections also keep a `Date` field `expiresAtTs`.
4. Money: pricing in integer **rupees**, payments in integer **paise**, rates in **paise**.
5. Mutable aggregates carry `version`.
6. `txn()` retries up to 30 times (store default 5). A `Failure` returned from inside a transaction is **committed first, then thrown**. This is used for wrong-OTP attempt counters and lazy expiry.

### 2.2 Infrastructure files

| File | Responsibility | Port notes |
|---|---|---|
| `env.ts` | zod-validated env (§7.4).<br>Guards: `TAKI_E2E` only with an emulator; `DEV_FIXED_OTPS` refused in production; `APP_ORIGIN`, `SESSION_SECRET` (≥32) and `PII_HASH_KEY` (≥32) required in production; `PAYMENT_PROVIDER=dev` refused in production.<br>`DEV_OTPS = {phone:123456, pickup:111111, delivery:222222}`. `devAutoVerifyAgencies()`. `requireDeliveryProof()` (default true). | → `backend/app/core/settings.py` (pydantic-settings) |
| `clock.ts` | `now()`; test override (`setTestNow`, `TEST_CLOCK`) only under vitest | Injectable clock dependency in FastAPI |
| `firebase/admin.ts` | Named app `taki`.<br>The emulator forces project `demo-taki`; production + emulator host is refused.<br>Credentials: inline (`FIREBASE_CLIENT_EMAIL/PRIVATE_KEY`) or ADC.<br>Firestore `ignoreUndefinedProperties`; storage bucket defaults to `${projectId}.appspot.com`. | Cloud Run → ADC (service account). Keep the "demo- project in emulator" guard. |
| `db/docstore.ts` | `DocStore` / `TxContext` interface. Operators: `== != < <= > >= in not-in array-contains array-contains-any`; `count`, `sum`, `runTransaction`, `batchWrite` (chunk 500); order by `__name__`. | Thin repo layer over `google-cloud-firestore` (async). `tx.create` → `transaction.create`. |
| `db/firestore-docstore.ts` | Firestore implementation (149 lines) | |
| `db/index.ts` | `getDocStore()` (test-injectable), `docStoreKind()` | |
| `db/emulator-probe.ts` | 1 s TCP probe of `FIRESTORE_EMULATOR_HOST` → 503 `database_unavailable` (5 s cache) | Optional |
| `db/collections.ts` | 26 collection names; subcollections `bookings/{id}/events`, `trips/{id}/events`; ids `schedules/driver:{id}` and `vehicle:{id}`; `phoneIndexId(role,e164)` (**unused**: the code keys `phoneIndex` by bare E.164) | Constants module |
| `db/schema.ts` | Every document shape (561 lines), §2.9 | → Pydantic models (single source of truth) |
| `http/handler.ts` | Route wrapper. Order: CSRF Origin check on non-GET (unless `csrf:false`) → emulator probe → auth (`public` still resolves an optional session) → params / query (repeated keys become arrays) / body parsing → body limits (JSON 1 MB, multipart 20 MB) → `Content-Type` enforcement (415) → rate limit → `fn`. Plain value → 200 JSON, `undefined` → 204. Always `Cache-Control: no-store`. | FastAPI dependencies + exception handlers |
| `http/errors.ts` | `DomainError` → `{error:{code,message,fields?,details?}}`; `ZodError` → 400 `invalid_request` with flattened `fields` ("a.b" → message); `retry-after` header from `details.retryAfterSeconds` | Pydantic `ValidationError` → same envelope and same `fields` key format |
| `http/origin.ts` | `isAllowedOrigin`: Origin or Referer must equal `APP_ORIGIN`; any localhost is allowed outside production. `clientIp`: first XFF hop only if `TRUST_PROXY_HEADERS=true`, else `"local"`. | Cloud Run sits behind a Google front end: set `TRUST_PROXY_HEADERS` |
| `http/rate-limit.ts` | Fixed window, `rateLimits/{sha256hex(bucket\|window)}`, transactional (10 attempts) | §2.6 table |
| `http/idempotency.ts` | `Idempotency-Key` header (`/^[A-Za-z0-9_.:-]{8,128}$/`). Doc `idempotency/{scope:userId:key}` (sha256 if >200 chars), stable-JSON request hash, 24 h TTL. Same key + different body → 422 `idempotency_key_reused`. | Used by booking request and payment create |
| `http/cursor.ts` | Opaque cursor = base64url(JSON array of orderBy values + id). `pageOf(limit+1)` | Keep the format if the frontend stores cursors (it treats them as opaque) |
| `http/after.ts` | Post-commit tasks via `next/server` `after()` (queued under vitest/scripts) | FastAPI `BackgroundTasks` |
| `http/crypto.ts` | `sha256Hex`, `hmacHex`, `randomDigits`, `safeEqual`, `stableStringify` (sorted keys, drops `undefined`) | |

### 2.3 Auth (`src/server/auth/**`, `modules/auth/**`)

| File | Rules enforced |
|---|---|
| `passwords.ts` | scrypt `N=2^15, r=8, p=1, keylen 64`, NFKC. Format `scrypt$v1$N$r$p$salt$hash`. Rehash on login when the parameters are outdated. A dummy hash on unknown phones gives constant time.<br>Policy: 8–64 chars, ≥1 letter, ≥1 digit, not the phone number (10-digit, 12-digit or `+` forms). |
| `otp.ts` | 6-digit code; only `HMAC(HKDF(SESSION_SECRET,"taki-otp-v1"), challengeId:code)` is stored. Expiry 5 min; **5 attempts per challenge** (cumulative across resends); 30 s resend cooldown; max 3 resends.<br>Purposes: `signup`, `reset_password`, `change_phone`. Signup and change_phone fail with 409 `phone_taken` (`details.role`) if the phone exists.<br>**Reset on an unknown or disabled phone creates a decoy challenge that can never verify** (no enumeration).<br>A successful verify returns a one-time `proofToken` (43-char base64url, 15 min, sha256 stored). `readProof` checks purpose, expiry and single use; `markProofConsumed` closes it.<br>Driver signup verify also returns a pending `invite` for that phone. |
| `rate-limits.ts` | Auth buckets (§2.6). Under `TAKI_E2E` the per-IP OTP and login buckets are skipped. |
| `crypto.ts` | `randomToken`, `sha256` (base64url), `randomOtpCode`, `deriveKey` (HKDF-SHA256 of `SESSION_SECRET`), `auditHash` (UA/IP, 22 chars) |
| `session-cookie.ts` | Cookie `taki_session` (dev) / `__Host-taki_session` (production; production is decided by `NODE_ENV`). Value `b64url(JSON{sid,r,exp}).b64url(HMAC-SHA256(SESSION_SECRET))`. `HttpOnly; SameSite=Lax; Path=/`; `Secure` in production. TTL 7 days; sliding renewal capped at 30 days. **Dev fallback secret constant** when `SESSION_SECRET` is unset. Web Crypto only (used by `proxy.ts`). |
| `sessions.ts` | `sessions/{sha256(sid)}` holds `{userId, role, expiresAt, expiresAtTs, revokedAt, userAgentHash, ipHash}`. `resolveSession` checks HMAC, then the doc (not revoked or expired, same role), then the user (active, same role).<br>`revokeSession` and `revokeUserSessions` (except the current one) are used on password reset, change and phone change.<br>`renewSession`: when <24 h remain, extend to +7 days (capped at creation + 30 days) and re-issue the cookie. **No route calls `renewSessionIfNeeded` today**, so renewal is effectively dead code. |
| `guards.ts` | `requireSession(req, role)`; `getServerSession` / `requireServerSession` (React `cache`, `next/headers`). **Unused by any page.** |
| `accounts.ts` | One phone = one account = one role: `phoneIndex/{e164}` (created with `tx.create`); `findUserByPhone` |
| `sms/{index,dev,msg91,types}.ts` | dev provider returns `devCode` (shown as "Dev OTP"); MSG91 Flow API (`MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER_ID`), 10 s timeout. dev is refused in production. |
| `modules/auth/service.ts` | **Signup** (customer / agency / driver): proof (purpose signup + same role) → phone free → policy → writes `users`, `phoneIndex`, profile doc and session, all in **one transaction**.<br>Agency: district must exist; `statesCovered ∪ {district.state}`; `searchTokens` (word prefixes 2–15 chars, ≤60); verification `pending` (or `verified` by `dev-auto` when `DEV_AUTO_VERIFY_AGENCIES`); identity document null.<br>Driver: `inviteId` (pending, same phone, not expired) gives an `active` link, accepts the invite and bumps `agency.stats.drivers`. `agencyId` (agency must be verified) gives a `pending` link.<br>**Login**: IP rate limit → lockout check (`LOGIN_LOCK` 5 failures → 15 min `lockedUntil`, 423 `account_locked`) → verify password → `account_disabled` → **wrong role revealed only after a correct password** (403 `forbidden`, `details.reason:"wrong_role"`; admin is never named) → reset counters → new session (new sid each login, so no fixation).<br>**Reset**: proof `reset_password` → revoke **all** sessions → new hash, unlock. |
| `modules/auth/session-user.ts` | `SessionUserDTO` = `{id, role, name, phoneMasked, photoUrl, agency?{id,name,verification,reason}, driver?{agencyLink,verification}}` |

### 2.4 Core (`src/server/core/**`): the only place cross-role transitions happen

**Booking state machine** (`src/lib/domain/booking-machine.ts`, pure):

```
awaiting_agency ─accept→ pending_payment ⇄ payment_failed ─paymentSucceeded→ confirmed → picked_up → in_transit → out_for_delivery → delivered
awaiting_agency ─reject | expireRequest→ rejected ; tripCancelled: awaiting_agency→rejected, else→cancelled
{awaiting_agency, pending_payment, payment_failed, confirmed} ─cancel→ cancelled ; pending_payment|payment_failed ─expirePayment→ cancelled
confirmed ─refusePickup→ cancelled ; payment_failed ─retryPayment→ pending_payment
```

- `applyEvent` is **idempotent**: if the booking is already in a status the event could produce, it returns `changed:false`. Otherwise it throws 409 `invalid_transition`.
- Each transition appends to `statusHistory` and sets `tab` (customer tab).
- Derived status sets: `HOLDING`, `TERMINAL`, `CANCELLABLE`, `PAYABLE`, `DRIVER_VISIBLE`, `PICKED_UP_OR_LATER`, `OPEN`.

| File | Responsibilities and business rules |
|---|---|
| `bookings.ts` | **request** (customer, needs Idempotency-Key). Checks: shipment owned, no `currentBookingId` (409 `shipment_has_open_booking`), status `open`; trip `published` and agency **verified**; `counts.awaiting + counts.held < 50` (`maxBookingsPerTrip`); `locateSegment` (`not_on_route`); goods (`goods_not_accepted` / `handling_not_supported` / `package_too_heavy`); `now < respondBy` and pickup checkpoint not departed (`departed`); `effectiveAvailableKg ≥ weight`.<br>Booking id `TAKI######`: 3 random candidates are checked inside the transaction. Writes the quote `quoteV2`, `respondBy = pickupDeparture − 60 min`, `display` + `searchTokens`, event `requested`, shipment → `booked`, `trip.counts.awaiting++`, `customer.stats.bookings++`, and notifies the agency.<br>**accept** (agency): lazy expiry first; verified agency; trip published; `fits()`; **price re-locked** at accept; `paymentDueAt = min(now + 120 min, pickupDeparture − 30 min)`; hold `{kg, kind:"unpaid", dueAt}`; counts awaiting→held.<br>**reject** (reason 3–300 chars). **cancelByCustomer** (before pickup; paid → refund job). **refusePickup** (driver, reason ≥5, `confirmed` only, full refund).<br>**pickup** (driver): trip published or in_progress; not earlier than `pickup.expectedDepartureAt − 24 h` (`too_early`); pickup OTP, 5 attempts (counter persisted on failure).<br>**startTransit** / **outForDelivery**: manual fallbacks.<br>**deliver**: `out_for_delivery` only; proof files ≤3 and required when `REQUIRE_DELIVERY_PROOF`; files must be `delivery_proof`/booking/active; delivery OTP. Creates the **`earnings/{bookingId}`** doc (`agencyNet = transportation + handling`, `platformFee = serviceFee`), bumps `trip.counts.delivered`, shipment `completed`, and the `delivered` stats of driver, agency and customer. Uploaded proofs are discarded if the transaction fails.<br>**addRemark**, **review** (once, delivered only, rating 1–5, comment ≤500). Review updates the running average for driver and agency and **re-snapshots the driver rating into future trips**.<br>**regenerateOtp** (customer): only once the driver has used up all 5 attempts (`otp_not_exhausted`). Pickup and delivery OTPs never collide. |
| `internal.ts` | `txn`/`fail`; ownership guards return **404 rather than 403** (no existence leak). `closeBooking` (reject, cancel or expire): removes the hold, fixes counts, reopens the shipment (`open`, `currentBookingId=null`). A succeeded payment becomes `refund_pending` with a refund `{refundId:"rf_"+paymentId}` and an outbox job; created or pending payments become `cancelled`. Writes event `rejected`/`cancelled`. |
| `lifecycle.ts` | `readBundle`; **lazy expiry** `dueExpiry`: `awaiting_agency` at `respondBy` → `expireRequest`; payable + unpaid hold past `dueAt` → `expirePayment`, **unless a checkout was created within the last 15 min** (`checkoutGraceMinutes`). `applyExpiry` sends notifications. Notification copy helpers live in `msg.*`. |
| `trips-lifecycle.ts` | **publish** (draft → published). Requires: verified agency; active vehicle owned by the agency; driver linked `active` + `available` + user active; `validateTripForPublish` (2–10 checkpoints, index order, origin km 0, strictly increasing km, times consistent, departure ≥ now + 60 min and ≤ 60 days, `offeredKg ≤ vehicle.maxPayloadKg`, ≥100 kg).<br>Schedule locks on `schedules/driver:{id}` and `vehicle:{id}`: interval `[departure − 60 min, arrival + 60 min]`; overlap → 409 `driver_schedule_conflict` / `vehicle_schedule_conflict`. Computes `pickupKeys`, snapshots vehicle and driver, notifies the driver.<br>**unpublish** (no awaiting or held bookings after expiry). **cancel** (reason 3–300; blocked if anything is picked up; cascades `tripCancelled` to every open booking with refunds; frees schedules; trip event).<br>**reassignDriver** (draft/published, nothing picked up, new driver linked, available and schedule-free; rewrites `driverId`/`display.driverName` on open bookings).<br>**checkpoint arrive/depart**: strict order via `nextStep`. Departing index 0 starts the trip (`in_progress`), allowed from departure − 120 min. Auto fan-out: depart ≥ pickup moves `picked_up` → `in_transit`; arrive ≥ drop moves `in_transit` → `out_for_delivery`; arriving at intermediate checkpoints sends a `checkpoint_reached` notification.<br>**complete**: last arrival recorded and no confirmed or in-flight bookings (`undelivered_shipments`); force-expires leftovers and frees schedules. |
| `schedules.ts` | `intervalForTrip`, `overlaps`, `findConflict` (ignores past intervals and the same trip), `withInterval`, `withoutTrip` (prune past) |
| `notify.ts` | `notifications` written **inside** business transactions; dedupe one per (user, kind) per transaction. Read side: list (cursor), `unreadCount` (aggregate count), `markRead` (ids, or all in 400-doc batches). |
| `jobs.ts` | Outbox `jobs` (types `refund`, `sms`). Claim with a 10 min lease; backoff `[1,5,15,60,60,60,60,60]` min; `JOB_MAX_ATTEMPTS=8` then `failed` + `OPS ALERT` log. If a final refund fails, the payment becomes `refund_failed`.<br>`applyRefundResult` (also used by the webhook) → `refunded` + customer notification. A refund retry **first asks the gateway for status** (Cashfree rejects duplicate refund ids).<br>`runJobsAfterCommit` uses `after()`. |
| `sweep.ts` | `runSweep`: up to 100 `awaiting_agency` with `respondBy ≤ now`, up to 100 `pending_payment`/`payment_failed` with `paymentDueAt ≤ now`, then due jobs. Correctness never depends on it (lazy expiry). `maybeSweep` exists but **is never called**. |
| `verification.ts` | Admin/ops verify or reject of agency and driver (reason ≥3 chars), with notification. `reviewedBy` = admin userId or `"ops"`. |
| `earnings.ts` | Read model: summary (total/pending/settled/onHold/thisMonth/lastMonth in IST), 6-month series, by-trip, by-booking, payments that actually moved money, settlements.<br>**recordSettlement**: reference (UTR) 3–64 chars; `through` YYYY-MM-DD; settles pending earnings delivered ≤ through (max 400) into a `settlements` doc and notifies the agency. **No payouts**: settlement is a record only. |
| `tracking.ts` | Stages built from **real events only**: status history, booking events, trip checkpoint actuals. `liveLocation` is always `null`. |
| `reviews.ts` | `listReviews` by driver or agency; `addRating` (rounded to 2 decimals) |
| `contact.ts` | `saveContactMessage` (honeypot `website`; IP HMAC'd with `PII_HASH_KEY`). `listPublicAgencies` (verified only, **scans up to 500 docs and filters in memory**). |
| `context.ts` | `SessionContext {userId, role, profileId, agencyId, sessionId, name, phone, expiresAt, createdAt}`, `Ctx {now, actor}`, `SYSTEM_ACTOR` |

### 2.5 Payments (`src/server/payments/**` + `app/api/payments/cashfree/_lib/cashfree-server.ts`)

| Piece | Real or simulated | Rules |
|---|---|---|
| `service.createOrder` | real logic | Customer-owned booking; lazy expiry; `already_paid`; payable status; hold must exist.<br>**Amount = `booking.pricing.totalPayable × 100`; client amounts are ignored.** Reuses an open payment of the same provider.<br>Starting a checkout **extends the hold to ≥ now + 15 min**, supersedes older open payments, and moves `payment_failed` → `pending_payment`.<br>Payment id `pay_…` is used as the Cashfree `order_id`. Gateway call happens outside the transaction; on failure the payment becomes `failed/gateway_error`. |
| `service.getStatus` | real | Owner only. If open + Cashfree: calls Get Order and `confirmPayment(source:"verify")`. If open + dev + expired: marks it expired. |
| `service.devConfirm` | **simulated** | 404 in production or when the provider is not dev. Token = HMAC(HMAC(SESSION_SECRET,"taki-dev-payments-v1"), paymentId), sha256 stored. The page `/customer/payment/dev-gateway?paymentId&token` offers Approve and Decline. **Nothing auto-succeeds.** |
| `service.handleCashfreeWebhook` | real (never hit live) | Raw body; signature = base64 `HMAC-SHA256(secret, timestamp + rawBody)`, timing-safe; timestamp tolerance 5 min.<br>Dedupe in `paymentEvents/{sha256(eventKey)}`. Unknown order → 200 ignored. `PAYMENT_SUCCESS/FAILED/USER_DROPPED_WEBHOOK` → confirm. `REFUND_STATUS_WEBHOOK` → `applyRefundResult`. |
| `confirmPayment` | real | **The single place a payment outcome is applied.** Idempotent on terminal status.<br>Amount mismatch → `failed/amount_mismatch` + OPS ALERT. Duplicate payment → refund `duplicate_payment`. A late payment is honoured if capacity still fits; otherwise it expires and is refunded (`late_payment`).<br>On success: booking `confirmed`, `paidAt`, hold → `{kind:"paid", dueAt:null}`, **`bookingSecrets` created (pickup and delivery OTPs)**, events `payment_succeeded` + `confirmed`, notifications to customer, agency and driver (`shipment_assigned`). |
| `gateway.ts` | — | `PAYMENT_PROVIDER=dev\|cashfree`; Cashfree without keys → 501 `payments_not_configured`. `gatewayFor(provider)` sends refunds back to the original provider. |
| `cashfree.ts` | real REST | `https://sandbox.cashfree.com/pg` or `https://api.cashfree.com/pg`; header `x-api-version` (default `2025-01-01`). Orders, payments, refunds, refund status; masked method label. |
| `dev.ts` | simulated | dev refunds succeed immediately (still through the job runner) |
| Frontend | real | `src/features/payment/cashfree-checkout.ts` loads the JS SDK v3 from CDN; the return page polls `GET /api/payments/[id]`. |

### 2.6 Rate limits (fixed window, `rateLimits` collection)

| Rule | Limit | Bucket |
|---|---|---|
| otpSendPhoneHour / Day | 5 / h, 10 / day | `otp:send:phone:{e164}` |
| otpSendIpHour | 20 / h | `otp:send:ip:{ip}` (skipped under TAKI_E2E) |
| otpVerifyIpHour | 60 / h | `otp:verify:ip:{ip}` (skipped under TAKI_E2E) |
| login | 30 / 15 min | `login:ip:{ip}` (skipped under TAKI_E2E) |
| bookingCreate | 30 / h | `booking:create:user:{id}` |
| paymentCreate | 20 / h | `payment:create:user:{id}` |
| upload | 60 / h | `upload:user:{id}` (photo, documents, delivery) |
| contact | 5 / h | contact form (per IP) |

### 2.7 Role modules (`src/server/modules/**`) and views

| Module | Functions | Notable rules |
|---|---|---|
| `customer/shipments.ts` | create, get, update, withdraw, getWithBookings, list | Shipping date: not past, ≤60 days (`past_date` / `date_too_far`). Edit and withdraw only while `open` with no booking. Address `location` kept only for `source:"current_location"`. List: no tab = open and unbooked; tab = through `bookings.tab`. |
| `customer/search.ts` | `findOffers`, `guestSearch`, `offersForShipment`, `tripDetails` | **One Firestore query**: `pickupKeys array-contains "{district}\|{istDate}"` + `status=="published"`, order `departureAt`, limit 200. Then in-memory `matchTrip`, verified-agency filter, user filters (vehicleClass, min/max price, minCapacity), sort, badges, top 100. Past dates are clamped to today. Counts `excludedForCapacity` and `excludedForRestrictions`. |
| `customer/bookings.ts` | request, list, tabCounts, view, cancel, regenerateOtp, review, tracking | **The customer DTO exposes pickup and delivery OTPs** (`otps`) until each is used. |
| `customer/payments.ts`, `dashboard.ts` | history, dashboard | |
| `agency/trips.ts` | create, update, deleteDraft, publish, unpublish, cancel, reassign, get, list, counts, preview, formOptions, publishBlockers | Draft defaults ₹12/km and ₹0.50/kg. Checkpoints built from **place ids** with `checkpointKms` (computed km, override ±30%). Published trips allow only "safe" edits (rates, offeredKg ≥ held, maxPackageKg, notes, driver). Advisory schedule check before core. `formOptions` flags busy vehicles and drivers. |
| `agency/bookings.ts` | counts, list, get, accept, reject | Contact gating: `agencySeesContact` / `agencySeesReceiver` by status (views/agency.ts) |
| `agency/drivers.ts` | list, get, setAvailability, approve, reject, remove | Remove is blocked by published or in-progress trips (`driver_has_active_trips`). `stats.drivers` is maintained. |
| `agency/invites.ts` | list, create, revoke | TTL 14 days. Phone taken by a non-driver → `phone_taken`; existing driver → ask them to request. One live invite per phone. **SMS outbox job `driver_invite`** (the only SMS job). |
| `agency/vehicles.ts` | list, get, create, update, remove, add/remove photo | `registrationIndex/{normalised reg}` uniqueness (`registration_taken`). Deactivate or remove is blocked by live trips. Max 5 photos. `imageKey` derived from class/model (a synthetic stock image). |
| `agency/profile.ts`, `dashboard.ts`, `earnings.ts`, `history.ts`, `shared.ts` | profile, verification submit (multipart), dashboard revenue, earnings, history token search | History uses `bookings.searchTokens array-contains`. `pageByOffset` cursor. |
| `driver/*` | access (linked guard `driver_not_linked`), dashboard, history (month range), profile (+ `requestAgencyLink`), shipments (pickup / refuse / transit / OFD / deliver multipart / remarks), trips (list, get, checkpoint, complete) | Driver sees bookings only from `confirmed` onward; contacts only while active. Delivery multipart: `otp, receivedBy?, remarks?, clientAt?, proof×1–3`. |
| `profile/service.ts` | getProfile, patchProfile, changePassword, changePhone, setPhoto, uploadDocument | Change password and phone need the current password and revoke other sessions. Change phone needs a `change_phone` proof and swaps `phoneIndex`.<br>Documents: agency 1 of aadhaar / pan / driving_license; driver driving_license + aadhaar. **Number validated** (Aadhaar 12 digits + Verhoeff; PAN `AAAAA9999A`; DL 10–20 alphanumeric), stored **masked + HMAC(PII_HASH_KEY)**, never in full.<br>Complete set + photo moves verification to `pending` with `submittedAt` (a verified account stays verified). |
| `admin/service.ts` | list, get, decide agencies and drivers; overview; settlements list/settle | Verify needs complete documents. Review order: ready (oldest `submittedAt`) first. |
| `views/{agency,customer,driver,common}.ts` | Doc → DTO projections | `mapsUrl()` builds a **Google Maps search URL** (lat/lng only for current-location addresses). Customer route stops carry `lat/lng` from the static `PLACES` table. |

### 2.8 Files (`src/server/files/**`)

- **Upload:** magic-byte sniffing (JPEG, PNG, WEBP, PDF). Size: documents 5 MB (PDF allowed), photos 5 MB, delivery proof 8 MB.
- **Storage path:** `private/{ownerType}/{ownerId}/{kind}/{fileId}.{ext}`, plus a `files/{fileId}` doc carrying the sha256.
- **Status:** `active` | `replaced` | `deleted`.
- **`canReadFile`:**
  - Admin and owner can read everything.
  - Identity documents: also the linked agency (for its drivers).
  - `vehicle_photo`: any signed-in user.
  - `delivery_proof`: the booking's customer, driver and agency.
  - `profile_photo`: only people who share a booking, or the driver's agency.
  - Missing and forbidden both return 404.
- **Serving:** `serveFile` streams the bytes through the API (`private, no-store`). There are no signed URLs.
- **`FileStore`:** Firebase Storage, lazily imported.

### 2.9 Firestore collections and key fields

| Collection (doc id) | Key fields |
|---|---|
| `users` (`usr_*`) | role, phone (E.164), phoneVerifiedAt, passwordHash, passwordChangedAt, status active/disabled, failedLoginCount, lockedUntil, lastLoginAt, agencyId, displayName |
| `phoneIndex` (`+91…`) | userId, role |
| `sessions` (sha256(sid)) | userId, role, expiresAt, **expiresAtTs (TTL)**, lastSeenAt, revokedAt, userAgentHash, ipHash |
| `otpChallenges` (`otp_*`) | phone, role, purpose, userId, codeHash, expiresAt(+Ts TTL), resendAvailableAt, attempts, resends, verifiedAt, proofHash, proofExpiresAt, consumedAt, dead |
| `rateLimits` (sha256 hex) | bucket, count, windowStart, expiresAt(+Ts TTL) |
| `idempotency` | scope, userId, requestHash, status, body, expiresAt(+Ts TTL) |
| `customers` (=userId) | fullName, dob (18+), phone, photo, stats{bookings, delivered} |
| `agencies` (`agc_*`) | ownerUserId, ownerName, agencyName, nameLower, searchTokens, districtId, state, statesCovered, vehicleCountRange, phone, photo, identityDocument{kind, numberMasked, numberHmac, file, backFile?}, verification{status, submittedAt, reviewedAt, reviewedBy, reason}, stats{vehicles, drivers, ratingAvg, ratingCount, delivered} |
| `drivers` (=userId) | fullName, phone, photo, license{numberMasked, numberHmac, file, validUntil}, aadhaar{…}, agencyLink{agencyId, agencyName, status pending/active/rejected/removed, via invite/request, requestedAt, decidedAt}, availability, verification, stats |
| `driverInvites` (`inv_*`) | agencyId, agencyName, phone, fullName, status, expiresAt, driverId |
| `vehicles` (`veh_*`) | agencyId, vehicleClass, modelId, makeModel, registrationNumber, maxPayloadKg, bodyType, dimensionsFt, acceptedGoods, handlingSupported, photos[], imageKey, status active/inactive/removed |
| `registrationIndex` (normalised reg) | vehicleId, agencyId |
| `schedules` (`driver:{id}` / `vehicle:{id}`) | kind, resourceId, intervals[{tripId, from, to}] |
| `trips` (`trp_*`) + `/events` (`tev_*`) | agencyId, agencyName, vehicleId, vehicle{snapshot}, driverId, driver{snapshot}, status, checkpoints[{index, placeId, placeName, districtId, districtName, state, kmFromOrigin, expected/actual Arrival/Departure}], departureAt, arrivalAt, distanceKm, capacity{vehicleMaxKg, offeredKg}, **holds{bookingId:{kg, kind, dueAt}} (the only capacity ledger)**, goods{accepted, handlingSupported, maxPackageKg, notes}, rates{perKmPaise, perKgPaise, handlingFeeRupees}, **pickupKeys[]**, progress, counts{awaiting, held, delivered}, publishedAt/startedAt/completedAt/cancelledAt, cancelReason, version |
| `shipments` (`shp_*`) | customerId, source/destination Address{line1, line2?, landmark?, districtId, districtName, state, pincode, location?, source}, receiver{name, phone}, package{weightKg, goodsCategory, packageType, description, pieces, specialHandling[], declaredValueRupees}, shippingDate, status open/booked/completed/withdrawn, currentBookingId, bookingIds[] |
| `bookings` (`TAKI######`) + `/events` (`bev_*`) | shipmentId, tripId, customerId, agencyId, driverId, vehicleId, status, tab, pickup/drop{checkpointIndex, districtId, placeName, expected…}, weightKg, goodsCategory, specialHandling, pricing (PricingBreakdownV2), respondBy, acceptedAt, paymentDueAt, paidAt, paymentId, statusHistory[], rejection, cancellation, reviewed, display{…}, searchTokens, version |
| `bookingSecrets` (=bookingId) | pickupOtp, deliveryOtp (**plaintext**), attempts, usedAt |
| `payments` (`pay_*` = Cashfree order_id) | bookingId, customerId, agencyId, provider, providerEnv, amountPaise, status (created, pending, succeeded, failed, cancelled, refund_pending, refunded, refund_failed), idempotencyKey, checkout{paymentSessionId, devTokenHash}, expiresAt, providerPaymentId, methodLabel, confirmation, failureReason, refund{…}, version |
| `paymentEvents` (sha256) | provider, type, orderId, receivedAt |
| `reviews` (=bookingId) | customerFirstName, driverId, agencyId, tripId, rating, comment |
| `earnings` (=bookingId) | agencyId, tripId, driverId, customerPaid, transportationCharge, handlingFee, platformFee, agencyNet, routeLabel, deliveredAt, status pending/settled/on_hold, settlementId |
| `settlements` (`stl_*`) | agencyId, amount, earningIds[], reference, periodThrough, settledAt, recordedBy |
| `notifications` (`ntf_*`) | userId, role, kind (25 kinds), title, body, link{type, id}, readAt |
| `files` (`fil_*`) | ownerType, ownerId, uploadedBy, kind, storagePath, contentType, sizeBytes, sha256, status, sample |
| `jobs` (`job_*`) | type refund/sms, payload, status, attempts, nextAttemptAt, lastError |
| `contactMessages` (`msg_*`) | name, phone, email, role, message, status, ipHash |

**Id formats:**
- Most documents: `newId(prefix)` = `prefix_` + 20 chars of base32 `[a-z2-7]`.
- Booking ids: `TAKI` + 6 digits.
- Prefixes: `usr agc veh trp shp pay ntf fil job inv otp tev bev stl rf msg`.

### 2.10 Indexes (`firestore.indexes.json`)

- **39 composite indexes**:

  | Collection | Count |
  |---|---|
  | trips | 6 |
  | bookings | 11 |
  | shipments | 2 |
  | payments | 3 |
  | notifications | 2 |
  | reviews | 2 |
  | earnings | 2 |
  | settlements | 1 |
  | vehicles | 2 |
  | drivers | 2 |
  | driverInvites | 2 |
  | agencies | 2 |
  | jobs | 1 |
  | contactMessages | 1 |

  The key search index is `trips(pickupKeys CONTAINS, status, departureAt)`.
- **Field overrides:**
  - Index exemptions on `bookings.statusHistory`, `bookings.pricing`, `bookings.display`, `trips.checkpoints` and `trips.holds`.
  - **TTL** on `expiresAtTs` for `sessions`, `rateLimits`, `idempotency` and `otpChallenges`.
- The Python backend must issue **exactly the same query shapes**, or these indexes must be regenerated.

### 2.11 Route handler table (102 files / 120 handlers)

Auth `public` = no session needed (an optional session is still resolved). `any` = any signed-in role. The service is the function the handler calls (modules unless noted). Request and response names come from `src/lib/api/contracts/*`.

| # | Method | Path (`/api/…`) | Auth | Request contract | Response | Service |
|---|---|---|---|---|---|---|
| 1 | POST | admin/agencies/[agencyId]/reject | admin | `RejectBody` | AdminAgencyDetailDTO | admin.decideAgency |
| 2 | GET | admin/agencies/[agencyId] | admin | — | AdminAgencyDetailDTO | admin.getAgency |
| 3 | POST | admin/agencies/[agencyId]/verify | admin | — | AdminAgencyDetailDTO | admin.decideAgency |
| 4 | GET | admin/agencies | admin | q `AdminListQuery` | {items: AdminAgencyListItemDTO[]} | admin.listAgencies |
| 5 | POST | admin/drivers/[driverId]/reject | admin | `RejectBody` | AdminDriverDetailDTO | admin.decideDriver |
| 6 | GET | admin/drivers/[driverId] | admin | — | AdminDriverDetailDTO | admin.getDriver |
| 7 | POST | admin/drivers/[driverId]/verify | admin | — | AdminDriverDetailDTO | admin.decideDriver |
| 8 | GET | admin/drivers | admin | q `AdminListQuery` | {items: AdminDriverListItemDTO[]} | admin.listDrivers |
| 9 | GET | admin/overview | admin | — | AdminOverviewDTO | admin.overview |
| 10 | GET | admin/settlements | admin | — | {items: AdminSettlementRowDTO[], available} | admin.listSettlements |
| 11 | POST | admin/settlements | admin | `SettleBody` | 201 AdminSettlementResultDTO | admin.settle → core.recordSettlement |
| 12 | POST | agency/bookings/[bookingId]/accept | agency | — | AgencyBookingDTO | agency.acceptBooking → core.bookings.accept |
| 13 | POST | agency/bookings/[bookingId]/reject | agency | `RejectBookingBody` | AgencyBookingDTO | agency.rejectBooking → core.bookings.reject |
| 14 | GET | agency/bookings/[bookingId] | agency | — | AgencyBookingDTO | agency.getBooking |
| 15 | GET | agency/bookings | agency | q `BookingListQuery` | {items, nextCursor, counts} | agency.listBookings |
| 16 | GET | agency/dashboard | agency | — | AgencyDashboardDTO | agency.getDashboard |
| 17 | DELETE | agency/driver-invites/[inviteId] | agency | — | 204 | agency.revokeInvite |
| 18 | GET | agency/driver-invites | agency | — | {items: InviteDTO[]} | agency.listInvites |
| 19 | POST | agency/driver-invites | agency | `DriverInviteBody` | 201 InviteDTO | agency.createInvite |
| 20 | POST | agency/drivers/[driverId]/approve | agency | — | AgencyDriverDTO | agency.approveDriver |
| 21 | POST | agency/drivers/[driverId]/reject | agency | `DriverRejectBody` | AgencyDriverDTO | agency.rejectDriver |
| 22 | GET | agency/drivers/[driverId] | agency | — | AgencyDriverDetailDTO | agency.getDriver |
| 23 | PATCH | agency/drivers/[driverId] | agency | `DriverPatchBody` | AgencyDriverDTO | agency.setAvailability |
| 24 | DELETE | agency/drivers/[driverId] | agency | — | 204 | agency.removeDriver |
| 25 | GET | agency/drivers | agency | q `DriverListQuery` | {items: AgencyDriverDTO[]} | agency.listDrivers |
| 26 | GET | agency/earnings | agency | q `EarningsQuery` | AgencyEarningsDTO | agency.getEarnings → core.agencyEarnings |
| 27 | GET | agency/history | agency | q `HistoryQuery` | {items: HistoryRow[], nextCursor} | agency.searchHistory |
| 28 | GET | agency/profile | agency | — | AgencyProfileDTO & summary | agency.getAgencyProfile |
| 29 | PATCH | agency/profile | agency | `AgencyProfilePatch` | same | agency.updateAgencyProfile |
| 30 | POST | agency/trips/[tripId]/cancel | agency | `CancelTripBody` | AgencyTripDTO | agency.cancelTrip → core.tripsLifecycle.cancel |
| 31 | POST | agency/trips/[tripId]/publish | agency | — | AgencyTripDTO | agency.publishTrip → core.publish |
| 32 | POST | agency/trips/[tripId]/reassign | agency | `ReassignDriverBody` | AgencyTripDTO | agency.reassignDriver → core.reassignDriver |
| 33 | GET | agency/trips/[tripId] | agency | — | AgencyTripDTO | agency.getTrip |
| 34 | PATCH | agency/trips/[tripId] | agency | `TripPatchBody` | AgencyTripDTO | agency.updateTrip |
| 35 | DELETE | agency/trips/[tripId] | agency | — | 204 | agency.deleteDraft |
| 36 | POST | agency/trips/[tripId]/unpublish | agency | — | AgencyTripDTO | agency.unpublishTrip → core.unpublish |
| 37 | GET | agency/trips/form-options | agency | q `TripFormOptionsQuery` | TripFormOptionsDTO | agency.tripFormOptions |
| 38 | POST | agency/trips/preview | agency | `TripPreviewBody` | TripPreviewDTO | agency.previewTrip |
| 39 | GET | agency/trips | agency | q `TripListQuery` | TripListResponse | agency.listTrips |
| 40 | POST | agency/trips | agency | `TripBody` | 201 AgencyTripDTO | agency.createTrip |
| 41 | DELETE | agency/vehicles/[vehicleId]/photos/[fileId] | agency | — | VehicleDTO | agency.removeVehiclePhoto |
| 42 | POST | agency/vehicles/[vehicleId]/photos | agency | multipart `photo` | VehicleDTO | agency.addVehiclePhoto |
| 43 | GET | agency/vehicles/[vehicleId] | agency | — | VehicleDTO | agency.getVehicle |
| 44 | PATCH | agency/vehicles/[vehicleId] | agency | `VehiclePatchBody` | VehicleDTO | agency.updateVehicle |
| 45 | DELETE | agency/vehicles/[vehicleId] | agency | — | 204 | agency.removeVehicle |
| 46 | GET | agency/vehicles | agency | q `VehicleListQuery` | {items: VehicleDTO[]} | agency.listVehicles |
| 47 | POST | agency/vehicles | agency | `VehicleBody` | 201 VehicleDTO | agency.createVehicle |
| 48 | POST | agency/verification | agency | multipart (kind, number, file, backFile?, photo?) | profile | agency.submitVerification |
| 49 | POST | auth/login | public | `LoginBody` | SessionUserDTO + Set-Cookie | auth.login |
| 50 | POST | auth/logout | public | — | 204 + cleared cookie | auth.logout |
| 51 | POST | auth/otp/resend | public | `OtpResendBody` | OtpChallengeDTO | otp.resendOtp |
| 52 | POST | auth/otp/send-phone-change | any | `OtpSendForPhoneChangeBody` | OtpChallengeDTO | otp.sendOtp |
| 53 | POST | auth/otp/send | public | `OtpSendBody` | 201 OtpChallengeDTO (devOtp in dev) | otp.sendOtp |
| 54 | POST | auth/otp/verify | public | `OtpVerifyBody` | OtpVerifyResultDTO {proofToken, expiresAt, invite?} | otp.verifyOtp |
| 55 | POST | auth/password/reset | public | `ResetPasswordBody` | {role} | auth.resetPassword |
| 56 | GET | auth/session | public | — | {user: SessionUserDTO\|null} | sessionUserFor |
| 57 | POST | auth/signup/agency | public | `AgencySignupBody` | 201 SessionUserDTO + cookie | auth.signupAgency |
| 58 | POST | auth/signup/customer | public | `CustomerSignupBody` | 201 SessionUserDTO + cookie | auth.signupCustomer |
| 59 | POST | auth/signup/driver | public | `DriverSignupBody` | 201 SessionUserDTO + cookie | auth.signupDriver |
| 60 | POST | customer/bookings/[bookingId]/cancel | customer | `CancelBookingBody` | CustomerBookingDTO | customer.cancelBooking → core |
| 61 | POST | customer/bookings/[bookingId]/otp/regenerate | customer | `RegenerateOtpBody` | {otps} | customer.regenerateOtp → core |
| 62 | POST | customer/bookings/[bookingId]/review | customer | `ReviewBody` | ReviewDTO | customer.reviewBooking → core |
| 63 | GET | customer/bookings/[bookingId] | customer | — | CustomerBookingDTO | customer.loadBookingView |
| 64 | GET | customer/bookings/[bookingId]/tracking | customer | — | TrackingDTO | customer.bookingTracking → core.loadTracking |
| 65 | GET | customer/bookings/counts | customer | — | Record<CustomerTab, number> | customer.tabCounts |
| 66 | GET | customer/bookings | customer | q `BookingsQuery` | Page<CustomerBookingListItem> | customer.listBookings |
| 67 | POST | customer/bookings | customer | `RequestBookingBody` + **Idempotency-Key**, RL bookingCreate | 201 CustomerBookingDTO (200 replay) | customer.requestBooking → core.bookings.request |
| 68 | GET | customer/dashboard | customer | — | CustomerDashboardDTO | customer.customerDashboard |
| 69 | GET | customer/payments | customer | q `CursorQuery` | Page<PaymentHistoryItem> | customer.listPayments |
| 70 | GET | customer/search | public | q `GuestSearchQuery` | OffersResponse | customer.guestSearch |
| 71 | GET | customer/shipments/[shipmentId]/offers | customer | q `OffersQuery` | OffersResponse | customer.offersForShipment |
| 72 | GET | customer/shipments/[shipmentId] | customer | — | ShipmentWithBookingsDTO | customer.getShipmentWithBookings |
| 73 | PATCH | customer/shipments/[shipmentId] | customer | `UpdateShipmentBody` | ShipmentDTO | customer.updateShipment |
| 74 | DELETE | customer/shipments/[shipmentId] | customer | — | 204 | customer.withdrawShipment |
| 75 | GET | customer/shipments | customer | q `ShipmentsQuery` | Page<ShipmentListItem> | customer.listShipments |
| 76 | POST | customer/shipments | customer | `CreateShipmentBody` | 201 ShipmentDTO | customer.createShipment |
| 77 | GET | customer/trips/[tripId] | public | q `TripDetailsQuery` | TripDetailsDTO | customer.tripDetails |
| 78 | POST | driver/agency-link | driver | `AgencyLinkBody` | DriverAppProfileDTO | driver.requestAgencyLink |
| 79 | GET | driver/dashboard | driver | — | DriverDashboardDTO | driver.getDashboard |
| 80 | GET | driver/history | driver | q `DriverHistoryQuery` | DriverHistoryDTO | driver.listHistory |
| 81 | GET | driver/profile | driver | — | DriverAppProfileDTO | driver.getDriverProfile |
| 82 | PATCH | driver/profile | driver | `DriverProfilePatchBody` | DriverAppProfileDTO | driver.updateDriverProfile |
| 83 | POST | driver/shipments/[bookingId]/deliver | driver | multipart (otp, receivedBy?, remarks?, clientAt?, proof×1–3), RL upload | DriverShipmentDTO | driver.confirmDelivery → core.deliver |
| 84 | POST | driver/shipments/[bookingId]/out-for-delivery | driver | `CheckpointActionBody` | DriverShipmentDTO | driver.outForDelivery |
| 85 | POST | driver/shipments/[bookingId]/pickup | driver | `PickupBody` | DriverShipmentDTO | driver.confirmPickup → core.pickup |
| 86 | POST | driver/shipments/[bookingId]/refuse-pickup | driver | `RefusePickupBody` | DriverShipmentDTO | driver.refusePickup |
| 87 | POST | driver/shipments/[bookingId]/remarks | driver | `RemarkBody` | 201 DriverEventDTO | driver.addRemark |
| 88 | GET | driver/shipments/[bookingId] | driver | — | DriverShipmentDTO | driver.getShipment |
| 89 | POST | driver/shipments/[bookingId]/start-transit | driver | `CheckpointActionBody` | DriverShipmentDTO | driver.startTransit |
| 90 | GET | driver/shipments | driver | q `DriverShipmentsQuery` | Page<DriverShipmentListItem> | driver.listShipments |
| 91 | POST | driver/trips/[tripId]/checkpoints/[index]/arrive | driver | `CheckpointActionBody` | DriverTripDTO | driver.recordCheckpoint → core.checkpoint |
| 92 | POST | driver/trips/[tripId]/checkpoints/[index]/depart | driver | `CheckpointActionBody` | DriverTripDTO | driver.recordCheckpoint → core.checkpoint |
| 93 | POST | driver/trips/[tripId]/complete | driver | — | DriverTripDTO | driver.completeTrip → core.complete |
| 94 | GET | driver/trips/[tripId] | driver | — | DriverTripDTO | driver.getTrip |
| 95 | GET | driver/trips | driver | q `DriverTripsQuery` | {items: DriverTripListItem[]} | driver.listTrips |
| 96 | GET | files/[fileId] | any | — | binary stream | files.serveFile |
| 97 | GET | geo/districts | public | — | district list (from `DISTRICTS`) | inline |
| 98 | GET | geo/nearest-district | any | q `NearestDistrictQuery` | NearestDistrictDTO / 422 `outside_service_area` | inline `nearestDistrict` |
| 99 | GET | health | public | — | HealthDTO {ok, store, payments, sms} | inline |
| 100–101 | POST, GET | internal/sweep | Bearer `CRON_SECRET` (csrf off) | — | SweepResult | core.runSweep |
| 102 | PUT | me/documents/[kind] | agency, driver | multipart (number, file, backFile?, validUntil?) | DocumentUploadResultDTO | profile.uploadDocument |
| 103 | POST | me/password | any | `ChangePasswordBody` | 204 | profile.changePassword |
| 104 | POST | me/phone | customer, agency, driver | `ChangePhoneBody` | SessionUserDTO | profile.changePhone |
| 105 | PUT | me/photo | customer, agency, driver | multipart `photo` | {photoUrl} | profile.setPhoto |
| 106 | GET | me/profile | any | — | ProfileDTO (role-discriminated) | profile.getProfile |
| 107 | PATCH | me/profile | customer, agency, driver | role-specific patch (parsed in service) | ProfileDTO | profile.patchProfile |
| 108 | GET | me | any | — | SessionUserDTO (401 when signed out) | sessionUserFor |
| 109 | POST | notifications/read | any | `MarkReadBody` {ids} or {all} | 204 | core.markRead |
| 110 | GET | notifications | any | q `NotificationsQuery` | Page<NotificationDTO> | core.listNotifications |
| 111 | GET | notifications/unread-count | any | — | {count} | core.unreadCount |
| 112 | GET | payments/[paymentId] | customer | — | PaymentStatusResponse | payments.getStatus |
| 113 | POST | payments/cashfree/order (**legacy alias**) | customer, RL paymentCreate | {bookingId, idempotencyKey} | CreatePaymentOrderResponse | payments.createOrder |
| 114 | GET | payments/cashfree/verify (**legacy alias**) | customer | q orderId | PaymentStatusResponse | payments.getStatus |
| 115 | POST | payments/cashfree/webhook | public, **csrf off**, raw body | Cashfree webhook | {ok…} | payments.handleCashfreeWebhook |
| 116 | POST | payments/dev/confirm | customer | `DevConfirmBody` | PaymentStatusResponse | payments.devConfirm |
| 117 | POST | payments/orders | customer, **Idempotency-Key**, RL paymentCreate | `CreatePaymentOrderBody` | 201 / 200 CreatePaymentOrderResponse | payments.createOrder |
| 118 | GET | public/agencies | public | q {q, districtId} | PublicAgencyDTO[] | core.listPublicAgencies |
| 119 | POST | public/contact | public, RL contact | `ContactBody` | ContactResultDTO | core.saveContactMessage |
| 120 | GET | reviews | any | q `ReviewsQuery` (driverId \| agencyId) | Page<ReviewDTO> | core.listReviews |

**Error catalog:** `src/lib/api/contracts/errors.ts`, 72 codes mapped to HTTP statuses (400/401/403/404/409/410/413/415/422/423/429/5xx). The frontend relies on `code`, `message`, `fields` and `details` (`attemptsLeft`, `retryAfterSeconds`, `role`/`reason`, `bookingId`, `conflictingTripId`, `lockedUntil`). FastAPI must reproduce this envelope and these status codes exactly.

---

## 3. Frontend coupling

### 3.1 How the frontend calls the backend

- **`src/lib/api/http.ts`** is the only `fetch` in the frontend.
  - Relative paths `/api/...`, `credentials: "same-origin"`, `cache: "no-store"`.
  - JSON or FormData bodies; `Idempotency-Key` header via `opts.idempotencyKey`; query builder that repeats keys for arrays.
  - Non-2xx responses become `ApiError(code, status, message, fields, details)`; a network failure becomes `network_error`.
- **`src/lib/api/client/*.ts`** wrap endpoints per role: `admin`, `agency`, `auth`, `customer`, `driver`, `notifications`, `payments`.
- **`src/lib/api/contracts/*.ts`** hold zod schemas and TS types shared by server and browser:
  - Schemas / types per file: admin 4 / 11, agency 15 / 38, auth 13 / 21, common 19 / 11, customer 11 / 21, driver 9 / 26, notifications 1 / 2, payments 3 / 5, errors 0 / 2.
  - Contracts import domain data. `DistrictIdSchema` and `PlaceIdSchema` refine against `DISTRICTS`/`PLACES`; `agency.ts` imports legacy `@/lib/domain/types`.
  - `fileUrl(id)` → `/api/files/{id}`.
- **`src/lib/schemas/*.schema.ts`**: frontend form schemas (login, otp, password, phone, profile, shipment-search) used by 11 feature files.
  - `route-draft.schema.ts` and `route-pricing.schema.ts` are **not imported anywhere** (dead v1 code that depends on `domain/cities.ts`).
- **No raw `fetch` and no `/api` literals** elsewhere, except `/api/files/<id>` mentioned in comments in `Avatar.tsx`, `FileUpload.tsx` and `AccountPhotoCard.tsx`. `Avatar.tsx:37` checks `src.startsWith("/api/")`.

### 3.2 Sessions, cookies and guards

1. **Cookie:** httpOnly `taki_session` / `__Host-taki_session`, set by FastAPI's equivalent of login and signup. JS never reads it.
2. **`src/proxy.ts`** (edge-ish, optimistic): verifies the HMAC with `SESSION_SECRET` by importing `@/server/auth/session-cookie`. This is **the only frontend → `src/server` import and must be removed.** Options:
   - (a) Copy the 170-line Web Crypto module into `apps/web/src/lib/auth/session-cookie.ts`, keep the cookie format byte-identical in Python, and give the web app `SESSION_SECRET`.
   - (b) Make proxy a presence-only check and rely on the API's 401 handling.
   - (c) Mint a Firebase session cookie and verify it with `firebase-admin` in proxy. This puts firebase-admin back into the web app, which goes against the spirit of the move.
3. **Browser session store** `src/features/auth/session.ts`: `useSyncExternalStore` cache of `GET /api/auth/session`. `setSessionUser` is called after login and signup.
4. **`useShellSession`** (`components/layout/useShellSession.ts`) → `{ready, signedIn, role, user}`.
5. **`RequireRole`** (`components/layout/RequireRole.tsx`): UX-only client guard (redirect to `loginFor(role, next)` or own dashboard + toast). Used by layouts in `src/app/{customer,agency,driver,admin/(console)}`. Customer `guestPaths`: `/customer/dashboard`, `/customer/vehicles`, `/customer/booking/`. Also `GuestOnly`.
6. Route config: `src/lib/config/routes.ts` (`roleForPath`, `dashboardFor`, `loginFor`) and `src/lib/utils/safe-redirect.ts`.

### 3.3 Server-side coupling to remove

| Item | Location | Action |
|---|---|---|
| `@/server/auth/session-cookie` import | `src/proxy.ts:4` | Replace (see §3.2) |
| `src/instrumentation.ts` | imports `./server/env`, `./server/db/emulator-probe` | Delete or replace with a no-op |
| All `src/app/api/**` | 102 route files + `_lib/cashfree-server.ts` | Delete; add Next `rewrites` `/api/:path*` → FastAPI (or App Hosting routing) |
| `src/server/**` | 85 files | Delete after port |
| Pages using `getServerSession` | **none** | — |
| Server components reading Firestore | **none** (all 58 `page.tsx` files are thin and render `"use client"` views) | — |
| `firebase-admin`, `server-only` deps | `package.json` | Remove from web |
| `src/lib/config/env.ts` `NEXT_PUBLIC_APP_MODE` demo/live | v1 leftover | Check usages and likely delete |

**Same-origin assumption:** cookies (`SameSite=Lax`, `__Host-` prefix needs no Domain attribute), the CSRF Origin check (`APP_ORIGIN`) and relative `/api` URLs all assume the API is on the web origin. Keeping `/api/*` same-origin through Next rewrites or Firebase App Hosting means `http.ts` and the cookie logic need no changes. A separate `*.run.app` origin would need CORS with credentials, `SameSite=None` and a cookie domain strategy.

---

## 4. Domain data shared between front and back

| Module (`src/lib/domain/`) | Content | Used by frontend | Python must replicate | Recommended source of truth |
|---|---|---|---|---|
| `places/districts.ts` | **142 districts** (TN 38, KL 14, KA 31, TG 33, AP 26): `[id, name, state, hqPlaceId, hqName, lat, lng]`, **approximate** HQ coordinates | yes (6 files: pickers, labels) | yes (validation, names, nearest district) | **JSON data file** (e.g. `backend/app/domain/data/districts.json`) → generated TS for the web, or served by `GET /api/geo/districts` |
| `places/places.ts` | `PLACES` = 142 HQ places + **14 extra hubs** (Hosur, Pollachi, Mettupalayam, Kumbakonam, Karaikudi, Sriperumbudur, Ambur, Kovilpatti, Palani, Hubballi, Tenali, Hindupur, Ramagundam, Secunderabad) = 156 checkpoint places | yes (CheckpointEditor, agency format) | yes (checkpoint build, map lat/lng) | same JSON |
| `places/geo.ts` | `haversineKm`; **26 curated leg distances** (`LEG_KM_TABLE`); `legKm` = table or `round(haversine × 1.25)`, min 1; `cumulativeKm`; `isKmOverrideAllowed` (±30%); `nearestDistrict` (≤120 km else null) | `geo.ts` via API only | yes, or **replaced by Google Routes/Geocoding** | Backend only |
| `places/pincode.ts` | 6-digit pincode, state prefixes (TN 60–64, KL 67–69, KA 56–59, TG 50, AP 51–53) | via contracts | yes | Backend + generated TS |
| `model.ts` | Enums: roles, states, goods categories (9), package types (7), special handling (4), vehicle classes (5), body types (4), vehicle count ranges, statuses, tracking and trip event types, notification kinds (25), file kinds | yes (36 imports) | yes | Python enums → OpenAPI → generated TS |
| `vehicles.ts` | 5 vehicle models (`tata_ace` 750 kg … `ashok_leyland_ecomet` 7000 kg) with imageKey; `vehicleImageSrc` | yes | yes (imageKey on vehicles) | JSON |
| `constants.ts` | `LIMITS` (weight 10–25,000 kg, rates ₹1–100/km and ₹0–20/kg…), `SERVICE_FEE_SLABS` (≤500 kg ₹350, ≤1000 ₹500, ≤2000 ₹750, else ₹1000), `OTP`, `LOGIN_LOCK`, `AVERAGE_SPEED_KMH=55`, `V2` timings (§2.4), `UPLOAD_LIMITS`, `JOB_BACKOFF_MINUTES` | partly (UPLOAD_LIMITS, V2, preview weight) | yes | Backend settings; web gets the few UI constants via a `/api/config` endpoint or a generated file |
| `pricing.ts` | `roundHalfUp` (paise → rupees, **half-up**), `serviceFeeFor`, `quote` (v1), `quoteV2` (lines distance, weight, handling-if-any-special-handling, service fee; total = sum of lines), `segmentKm`, `estimateDurationMins`, rupees↔paise | yes (preview UI, HelpView, SetPricingView) | **yes, bit-exact** | Backend; the web should call `POST /agency/trips/preview` rather than re-implement |
| `capacity.ts` | `isHoldActive`, `heldKg`, `effectiveAvailableKg`, `fits`, `capacityInvariant` | no | yes | Backend |
| `segments.ts` | `locateSegment` (first non-last checkpoint in source district, then first later checkpoint in destination district), `pickupKeysFor`, `respondByFor`, `goodsProblem` | no | yes | Backend |
| `matching.ts` | `matchTrip` check order: published → route → date → departed → goods → capacity; `compareOffers` (4 sorts, ties broken by price, rating, id); `offerBadges` (≥2 results; best_price > top_rated > more_capacity) | types only | yes | Backend |
| `trip-rules.ts` | `checkpointIssues`, `checkpointKms`, `capacityIssues`, `goodsIssues`, `publishTimingProblem`, `publishBlockers`, IST `datetime-local` helpers | yes (`AddRouteView` live validation) | yes | Backend authoritative; web keeps a light client copy or uses preview errors |
| `booking-machine.ts` | state machine + tabs | `tabOf` labels | yes | Backend |
| `dates.ts` | IST helpers (`todayIst`, `isoDateFromInstant`, `istInstant`…) | yes | yes | Both (tiny) |
| `ids.ts` | `newId` (base32 20), `bookingIdCandidates`, `BOOKING_ID_PATTERN` | patterns | yes | Backend |
| `phone.ts` | normalise Indian mobile → E.164 `+91[6-9]xxxxxxxxx` | yes | yes | Both |
| `cities.ts`, `types.ts` (v1) | 14 v1 cities, legacy types | `PricePreview`, `format/index.ts` (`cityName`), 2 dead schemas | no | Delete after cleaning the remaining users |

---

## 5. Current matching, pricing, maps and payments: real vs simulated

| Area | Behaviour today | Real / simulated |
|---|---|---|
| Matching | **District-level.** A shipment's source and destination are districts (`Address.districtId`). A trip is a list of hub places, each mapped to one district. Search = `pickupKeys` contains `{sourceDistrict}\|{IST date}`, then in-memory segment, time, goods and capacity checks. No radius or geo-distance search; no pincode-level matching. | Real logic, coarse geography |
| Distance | `legKm`: 26 curated pairs; otherwise **haversine between approximate HQ coordinates × 1.25**. Agencies may override cumulative km within ±30%. The UI labels it "approx. road km". | **Approximate.** Google Routes is not integrated. |
| Duration | km × 60 / 55 km/h | Estimate |
| Pricing | Integer quote over **segment km** (drop km − pickup km): distance + weight + handling (flat, only when any special handling is selected) + service fee slab. Quoted at request and re-locked at accept. No GST line. | Real |
| Current location | `navigator.geolocation` (NewShipmentView) → `GET /api/geo/nearest-district` (nearest HQ ≤120 km). **No reverse geocoding**; lat/lng stored only for `current_location` addresses. | Approximate |
| Maps | `features/booking/RouteMap.tsx` + `route-map-layout.ts`: **SVG drawing** of stops projected from place lat/lng, captioned "Illustrative route — not live location". Driver views link to a Google Maps **search URL** (`mapsUrl`). No Maps JS, Places or Geocoding API. | **Illustrative** |
| Tracking | Real driver events only (checkpoint arrive/depart, pickup/deliver OTPs, remarks, proof photos). `liveLocation: null`. | Real events, no GPS |
| Vehicle photos | Synthetic stock images by `imageKey`, plus optional uploaded photos | Illustrative by default |
| SMS / OTP | dev provider shows the code on screen ("Dev OTP"); `DEV_FIXED_OTPS` gives 123456 / 111111 / 222222. MSG91 adapter written, never verified live. SMS outbox job is only used for driver invites; `SMS_NOTIFICATIONS` flag is **unused**. | Simulated in dev |
| Payments (dev) | Order → dev page with Approve / Decline; nothing moves until clicked; refunds succeed instantly | **Simulated** |
| Payments (Cashfree) | Create order, Get Order verify on poll, signed webhook with dedupe, refunds with status re-check, JS SDK v3 hosted checkout | Real code; **no sandbox run recorded** |
| Settlements | Ledger only (ops/admin enter UTR) | Real record, **no payouts** |
| Verification | Admin page / ops CLI reviews masked document numbers + files. No external KYC. | Manual |

---

## 6. Tests

### 6.1 Unit (vitest): 28 files, 217 cases

| Suite | Cases | Covers | Reuse for FastAPI |
|---|---|---|---|
| `tests/unit/domain-v2.test.ts` | 18 | booking machine, capacity, segments, pricing v2, places | **Port to pytest** (golden values) |
| `tests/unit/pricing.test.ts` | 8 | v1/v2 quote rounding | Port (golden values) |
| `tests/unit/format-and-redirect.test.ts` | 5 | `lib/format`, `safeRedirect` | **Keep in web** |
| `server/auth/*` (accounts 10, crypto-cookie 7, otp 7, profile-admin 7, proxy 6, sessions-guards 5) | 42 | signup / login / lockout / reset, cookie HMAC, OTP rules, proxy redirects | Port the behaviours. `proxy.test.ts` stays with the web (rewrite for the new proxy). |
| `server/agency/*` (fleet 11, trip-rules 9, trips-bookings 15) | 35 | vehicles, invites, drivers, trip drafts, publish, accept/reject | Port |
| `server/customer/*` (bookings-views 7, matching 10, request-flow 6, shipments-search 9) | 32 | search, matching, request, views | Port |
| `server/driver/*` (profile 3, shipments 19, trips-dashboard 14) | 36 | pickup / deliver OTP, checkpoints, fan-out | Port |
| `server/core/*` (concurrency 10, lifecycle 7, routes 6, memory-docstore 3, emulator-probe 3, env 2, dev-fixed-otps 3, seed 1) | 35 | **concurrency of capacity holds and schedules**, lazy expiry, route wrapper | Port concurrency and lifecycle (emulator-only in Python). Drop memory-docstore and seed. |
| `server/payments/payments.test.ts` | 6 | confirm, duplicate, late, refunds, webhook | Port |

- **Support:** `tests/support/memory-docstore.ts` (415 lines, an in-memory Firestore emulation), `memory-filestore.ts`, `world.ts` (fixture builder over the seed builders), `harness.ts`.
- **Emulator pass:** `vitest.emulator.config.mts` re-runs core + payments against Firestore.
- **Python equivalent:** pytest against the Firestore emulator with per-test fixture factories. That matches the "tests create their own fixtures" decision.

### 6.2 E2E (Playwright): 13 specs, about 144 tests (24 `test.skip` / `fixme` call sites, mostly conditional on project or viewport)

| Spec | Tests | State |
|---|---|---|
| `auth.spec.ts` | 24 | v2; uses dev OTP and seeded phones (5 refs) |
| `admin.spec.ts` | 12 | v2; logs in as **seeded admin 9000000001** |
| `agency-journey.spec.ts` / `agency-trips.spec.ts` / `agency-bookings.spec.ts` | 11 / 4 / 5 | v2; `agency-flow.ts` helper |
| `customer-search.spec.ts` / `customer-journey.spec.ts` / `booking.spec.ts` / `payment-tracking.spec.ts` | 5 / 9 / 6 / 7 | v2; `booking-flow.ts` uses **seeded customer 9876543210 and agency 9876543220, password `Taki@2026`**, and `dateWithOffers()` expects **seeded Coimbatore → Chennai trips** |
| `driver-app.spec.ts` | 13 | v2; seeded driver |
| `integration.spec.ts` | 14 | **Stale v1 (T5)**: crawler, guards, resilience with corrupt localStorage `STORE_KEY`, double submission via `state.db.payouts`, performance |
| `responsive-a11y.spec.ts` | 18 | **Mostly stale**: injects `taki-demo-v1` localStorage sessions (6 places) |
| `visual.spec.ts` | 16 | **Stale**: `taki-demo-v1` localStorage; writes `test-results/visual/*.png` (tracked) |

Last recorded run (`docs/planning/v2/03-e2e-triage.md`, 2026-11-14): module specs **65 pass / 11 fail / 3 skipped**, with 11 known UI/locator failures listed there.

**Reuse against FastAPI:**
- The UI specs are backend-agnostic: they drive the browser and call `/api/auth/login` and `/api/customer/search` over HTTP. They survive if `/api` stays same-origin.
- **But all v2 helpers assume seeded accounts and trips.** With an empty database, rewrite them with API fixture factories:
  - signup through the Firebase Auth emulator OTP;
  - an agency auto-verified by an admin created by a bootstrap script or a test-only endpoint;
  - vehicle + driver + published trip created through the API.
- The global setup (`npm run seed -- --reset`) must become "reset emulators" (+ admin bootstrap).

---

## 7. Risks and gaps

### 7.1 Auth model change (largest risk)
- **Today:** server OTP (`otpChallenges`, MSG91/dev SMS, proof tokens) + scrypt passwords in `users` + own sessions.
- **Target:** Firebase phone OTP for signup and reset, phone + password for daily login.
  - Firebase Auth has **no phone + password credential**.
  - Either keep the backend password hash (scrypt or argon2 in Python; existing hashes are irrelevant with an empty DB) and the backend session cookie, verifying a Firebase ID token (`phone_number` claim) where today's `proofToken` is consumed: signup, reset, change phone.
  - Or use a synthetic email/password credential linked to the phone.
  - Decide before porting `modules/auth`, `profile.changePhone`, `invites`, `otp.verify`'s `invite` lookup and the lockout and rate-limit logic.
- Firebase phone auth needs reCAPTCHA / App Check on web and **an auth emulator entry in `firebase.json`** (missing).
- Dev "Dev OTP" display goes away. The auth emulator exposes codes through its REST API for tests.

### 7.2 Data and format compatibility (empty DB helps, but the code depends on string formats)
- **ISO timestamps are compared as strings.** Examples: `hold.dueAt > graceUntil`, `e.deliveredAt > t.lastDeliveredAt`, `.localeCompare`, and Firestore range queries `respondBy <= at` / `paymentDueAt <= at` / `nextAttemptAt <= now`.
  - Python must always emit `YYYY-MM-DDTHH:MM:SS.sssZ` (JS `toISOString`).
  - `datetime.isoformat()` produces `+00:00` and microseconds, which **breaks ordering**.
- **Rounding:** JS `Math.round` rounds .5 up, Python `round` rounds half to even. Use explicit half-up integer math (`roundHalfUp(paise) = floor((round(paise)+50)/100)`) and `Decimal` for paise.
- **Cursor format** (base64url JSON array) and error `fields` keys (`"checkpoints.2.expectedArrivalAt"`): the frontend displays these keys, so Pydantic's `loc` must be mapped to dotted paths.
- **Query semantics:** zod-style query arrays (repeated keys), `in` limited to 30 values (the code chunks at 30), `array-contains`.
- **Cookie HMAC format** must match the web proxy if option (a) in §3.2 is chosen.

### 7.3 Behaviour that is easy to lose in a port
- Committed-failure transactions (wrong OTP attempt counters persist while the request returns 422).
- Lazy expiry inside every booking transaction.
- 404-not-403 ownership.
- Wrong-role disclosure only after a correct password.
- Reset-password decoy challenges.
- Idempotency replay semantics (201 vs 200).
- Notification dedupe per (user, kind) per transaction.
- Review rating re-snapshot into future trips.
- `after()` refunds plus the sweep backstop.

### 7.4 Environment variables to carry over
- **Firebase / app:** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_STORAGE_BUCKET`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST`, `APP_ORIGIN`, `SESSION_SECRET`, `PII_HASH_KEY` (never rotate: document HMACs).
- **SMS:** `SMS_PROVIDER`, `MSG91_*`, `SMS_NOTIFICATIONS`. Likely dropped with Firebase OTP, except invite SMS.
- **Payments:** `PAYMENT_PROVIDER`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV`, `CASHFREE_API_VERSION`.
- **Ops and flags:** `CRON_SECRET`, `TRUST_PROXY_HEADERS`, `DEV_AUTO_VERIFY_AGENCIES`, `DEV_FIXED_OTPS`, `REQUIRE_DELIVERY_PROOF`, `TAKI_E2E`, `SEED_PASSWORD`, `SEED_ALLOW_REMOTE`, `FIREBASE_PROD_PROJECT_ID`.
- **New:** Google Maps key(s), Firebase web config (`NEXT_PUBLIC_FIREBASE_*`) for phone auth.

### 7.5 Empty database
- **No admin can exist without the seed.** Provide `scripts/bootstrap_admin.py` (or `backend` CLI).
- Agencies must be verified by an admin before they can publish, so e2e needs an admin fixture path or `DEV_AUTO_VERIFY_AGENCIES`.
- The seed dataset (`src/server/seed/*`, 783 lines, `scripts/seed.ts`, sample assets) and `docs/DEMO_LOGINS.md` and the README demo table become obsolete.

### 7.6 Ops, tooling and environment
- **Vitest path casing:** must run from `D:\urgent`, not `d:\urgent`. A lower-case drive letter breaks module identity / `server-only` resolution on Windows. The same care applies to pytest rootdir and tooling.
- **Line endings:** 91 CRLF files + 1 mixed (`src/server/auth/guards.ts`), no `.gitattributes`. Add `.gitattributes` (`* text=auto eol=lf`; `*.png binary`) **in a separate commit** before moving files, so `git mv` diffs stay readable.
- **Java 21** for emulators: `/c/Program Files/Common Files/Oracle/Java/javapath` must be on PATH (Git Bash).
- **Python 3.12** via `py -3.12`.
- **Docker 29** is installed.
- **gcloud is not installed:** Cloud Run deploy, Cloud Scheduler (sweep) and Secret Manager need it locally, or a GitHub Actions workflow with Workload Identity Federation.
- **Firebase App Hosting** must route `/api/*` to Cloud Run (or Next rewrites to the Cloud Run URL) to keep cookies first-party. Check App Hosting's rewrite / `apphosting.yaml` support before relying on it.
- **Cron:** `/api/internal/sweep` (GET or POST, Bearer `CRON_SECRET`) was built for Vercel Cron. Map it to Cloud Scheduler with OIDC or a bearer token. The `TRUST_PROXY_HEADERS` comment mentions Vercel.

### 7.7 Dead or stale code to drop, not port
- `maybeSweep`, `renewSessionIfNeeded`, `getServerSession` / `requireServerSession`, `phoneIndexId`.
- `SMS_NOTIFICATIONS` flag.
- The unused `@cashfreepayments/cashfree-js` package.
- `lib/domain/cities.ts` and `types.ts` (v1), `route-draft.schema.ts`, `route-pricing.schema.ts`, `lib/config/env.ts` (demo/live).
- `docs/backend-integration.md` (describes the v1 localStorage adapters), `scripts/shot.mjs`'s localStorage sessions.
- Legacy routes `payments/cashfree/{order,verify}` (marked "kept for one release").

### 7.8 Repo hygiene
- The 46 tracked `test-results/visual/*.png` files are modified in the working tree.
- 992 tracked agent-skill files in `.agents/` and `.claude/`.
- The brand folders duplicate `Reference.jpeg`.
- Decide what moves into `apps/web` and what stays at the root.

### 7.9 Security notes to carry over
- `bookingSecrets` stores pickup and delivery OTPs in plaintext. The customer must see them, so this is acceptable, but keep them Admin-only.
- Document numbers are only masked + HMAC.
- Webhook raw-body handling: FastAPI must read `await request.body()` **before** any JSON parsing.
- CSP `form-action` includes `*.cashfree.com`. The Cashfree SDK and Google Maps scripts will need `script-src` and `connect-src` once a CSP for scripts is added.

---

## 8. Recommended move map

| Current path | Target | Action |
|---|---|---|
| `src/app/**` except `src/app/api/**` | `apps/web/src/app/**` | move |
| `src/app/api/**` (102 routes + `_lib`) | `backend/app/api/routers/{admin,agency,auth,customer,driver,files,geo,health,internal,me,notifications,payments,public,reviews}.py` | **port, then delete** |
| `src/components/**`, `src/features/**` | `apps/web/src/{components,features}/**` | move |
| `src/lib/api/http.ts`, `src/lib/api/client/**` | `apps/web/src/lib/api/**` | move (no change if `/api` stays same-origin) |
| `src/lib/api/contracts/**` | `apps/web/src/lib/api/contracts/**` (TS types, ideally **generated from FastAPI OpenAPI**) + `backend/app/schemas/**` (Pydantic) | split: Pydantic is authoritative |
| `src/lib/api/contracts/errors.ts` | `backend/app/core/errors.py` (catalog) + web copy (messages) | port + keep |
| `src/lib/schemas/**` | `apps/web/src/lib/schemas/**` | move (delete `route-draft`/`route-pricing`) |
| `src/lib/domain/{booking-machine,capacity,matching,segments,pricing,trip-rules,ids}.ts` | `backend/app/domain/*.py` | port; keep only UI-needed bits in web (`tabOf` labels, IST helpers, client trip-rule hints) |
| `src/lib/domain/places/**`, `vehicles.ts`, enums from `model.ts`, `constants.ts` | **`backend/app/domain/data/*.json`** (source of truth) → generated `apps/web/src/lib/domain/generated/*.ts` | convert |
| `src/lib/domain/{dates,phone}.ts`, `src/lib/format/**`, `src/lib/utils/**`, `src/lib/config/{nav,routes}.ts` | `apps/web/src/lib/**` | move |
| `src/lib/domain/{cities,types}.ts`, `src/lib/config/env.ts` | — | delete (after fixing `format/index.ts`, `PricePreview.tsx`, `contracts/agency.ts`) |
| `src/proxy.ts` | `apps/web/src/proxy.ts` | rewrite without `@/server` |
| `src/instrumentation.ts` | — | delete |
| `src/server/db/**` | `backend/app/db/{client,repo,collections}.py`, `backend/app/models/*.py` | port |
| `src/server/core/**` | `backend/app/services/core/*.py` | port |
| `src/server/modules/**` | `backend/app/services/{admin,agency,auth,customer,driver,profile}/*.py` | port |
| `src/server/views/**` | `backend/app/views/*.py` (or response builders in services) | port |
| `src/server/auth/**` | `backend/app/auth/*.py` (Firebase ID-token verify, password hash, sessions, guards) | port + redesign (§7.1) |
| `src/server/payments/**`, `app/api/payments/cashfree/_lib/cashfree-server.ts` | `backend/app/payments/{gateway,dev,cashfree,service}.py` | port |
| `src/server/files/**` | `backend/app/files/*.py` | port |
| `src/server/http/**` | `backend/app/core/{errors,rate_limit,idempotency,cursor,origin}.py`, FastAPI middleware | port |
| `src/server/env.ts`, `clock.ts`, `firebase/admin.ts` | `backend/app/core/{settings,clock,firebase}.py` | port |
| `src/server/seed/**` | — | **delete** (empty DB); reuse `builders.ts` ideas in pytest factories |
| `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules` | `firebase/` (+ auth emulator, ports kept: 8080 / 9199 / 4000, add auth 9099) | move |
| `scripts/ops.ts`, `scripts/sweep.ts` | `backend/app/cli.py` (or `scripts/ops.py`) | port |
| `scripts/seed.ts`, `scripts/seed/assets/*` | `scripts/bootstrap_admin.py` only | delete + new |
| `scripts/e2e.mjs`, `scripts/shot.mjs` | `scripts/` (update) / delete `shot.mjs` | keep / delete |
| `tests/unit/{format-and-redirect,server/auth/proxy}.test.ts` | `apps/web/tests/unit/` | move / rewrite |
| other `tests/unit/**`, `tests/support/{memory-docstore,memory-filestore,world,harness}.ts` | `backend/tests/**` (pytest + emulator) | port, then delete |
| `tests/e2e/**`, `tests/support/e2e-global-setup.ts` | `apps/web/tests/e2e/**` (or root `e2e/`) | move; rewrite helpers for an empty DB; rewrite or delete `integration`, `visual`, `responsive-a11y` v1 parts |
| `playwright.config.ts`, `vitest.config.mts`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `next-env.d.ts`, `package.json`, `package-lock.json`, `AGENTS.md` | `apps/web/` | move; drop `firebase-admin`, `server-only`, `tsx`, `cashfree-js`; add `rewrites()` |
| `vitest.emulator.config.mts` | — | delete |
| `public/**` | `apps/web/public/**` | move |
| `TAKI_website_assets/`, `TAKI_Website_Images_Original_Logo/`, `references/`, `Reference.jpeg` | `docs/design/` (or keep at root, still eslint-ignored); drop the duplicate root `Reference.jpeg` | move |
| `docs/**` | `docs/` (`docs/v1`/`planning` archive; mark `backend-integration.md` and `DEMO_LOGINS.md` obsolete) | keep / archive |
| `.env.example`, `.env.development` | `apps/web/.env.example` (NEXT_PUBLIC_*), `backend/.env.example` | split |
| `test-results/visual/*.png` | untrack or move under `apps/web` | decide |
| new | `backend/{Dockerfile,pyproject.toml}`, `.github/workflows/{web,backend,firebase}.yml`, `.gitattributes`, `apphosting.yaml` | create |
