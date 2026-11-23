# TAKI v2 — Backend Architecture (P2)

Author: P2 (Backend Architect). Date: 2026-11-13. Branch: `feat/marketplace`.
Inputs: `00-requirements.md` (binding), `p1-audit.md`, `AGENTS.md`, `node_modules/next/dist/docs/01-app/**` (proxy, route handlers, cookies, data-security, `after`), `src/lib/domain/**`, `src/lib/services/**`, `src/app/api/payments/cashfree/**`, `docs/backend-integration.md`.

This document is the contract for dev agents D1–D5. Where it conflicts with `docs/backend-integration.md` (which assumed Cloud Functions + Firebase phone auth), **this document wins**; D5 updates that doc at the end.

---

## 0. Decisions at a glance

| # | Topic | Decision |
|---|---|---|
| 0.1 | Server runtime | All business logic runs in **Next.js route handlers (Node runtime)** under `src/app/api/**`, calling server-only modules in `src/server/**` that use `firebase-admin`. No Cloud Functions. No Server Actions for business writes (one HTTP surface, so CSRF, authZ and tests are uniform). Server Components may call `src/server/modules/*` read functions directly, after `requireSession()`. |
| 0.2 | Auth | **Server-issued sessions, not Firebase Auth** (reasons in §3.1). Server OTP (hashed, peppered), scrypt passwords, opaque session id in a **signed httpOnly cookie**, session record in Firestore (revocable). |
| 0.3 | Database | Firestore via `firebase-admin`, reached only through a `DocStore` interface (§2). Two implementations: `FirestoreDocStore` (emulator + production) and `MemoryDocStore` (**vitest only**, lives under `tests/`, cannot be imported by the app). |
| 0.4 | Files | Firebase Storage via a `FileStore` interface. All reads go through `GET /api/files/[fileId]` (authorization, then stream). Works identically on the Storage emulator, where signed URLs cannot be produced. Only masked document numbers are stored in Firestore. |
| 0.5 | Clients and Firestore | Clients never touch Firestore or Storage. `firestore.rules` and `storage.rules` deny everything. The `firebase` client SDK is **not** added. |
| 0.6 | Dev and test | The Firebase Emulator Suite (Firestore + Storage) with project id `demo-taki`, which needs Java 21 (the owner is installing it). Vitest runs on `MemoryDocStore` with no Java. The same suites can be re-run against the emulator with `npm run test:emulator`. See §1. |
| 0.7 | Booking status | `awaiting_driver` is renamed `awaiting_agency` and `declined` becomes `rejected`, as P1 recommended. The `draft` booking status is dropped (the shipment is the draft). The other Phase 1 names are kept. |
| 0.8 | Capacity | Whole-trip capacity, as in Phase 1. Every hold lives in a `holds` map **on the trip document**, so availability can be computed from one document and expiry stays safe without a writer (§6). |
| 0.9 | Side effects | State changes and their notifications are written in **one Firestore transaction**. External calls (refunds, SMS) go to an **outbox** (`jobs`) inside the same transaction and run after commit (`after()` from `next/server`), with retries driven by the sweep. |
| 0.10 | Who approves | **Agency** accepts or rejects booking requests. Drivers execute (pickup, checkpoints, delivery). Agency verification is done by an ops script (`npm run ops`); there is no admin UI in v2. |

---

## 1. Running and testing (the Java trade-off, for the orchestrator)

### 1.1 Options considered

| Option | Persistence | Needs | Verdict |
|---|---|---|---|
| A. **Firebase Emulator Suite** (Firestore + Storage) | Real Firestore semantics (transactions, indexes warnings, pessimistic locks); exports to `.data/emulators` | Java **21+** (firebase-tools ≥ 14 requires JDK 21 for the Firestore/Storage emulators), `firebase-tools` devDep | **Primary for `npm run dev`, e2e and the emulator test pass.** No real project or credentials. |
| B. Real Firebase dev project via `.env.local` | Real cloud | Service-account JSON; **Cloud Storage for Firebase now requires the Blaze plan** for new default buckets | Fallback only (staging/production). Never the default for dev. |
| C. `MemoryDocStore` + `MemoryFileStore` | In-process, per test | Nothing | **Vitest only.** Lives in `tests/support/**` and is injected via `setDocStoreForTests()`. It is never bundled into the app, so it cannot become "mock data". |

**Recommendation:**
- Unit and integration tests (`npm test`) always run on C, so CI and agents work without Java.
- `npm run dev` and Playwright run on A.
- `npm run test:emulator` re-runs the integration suites (capacity, idempotency, payments) on A, wrapped in `firebase emulators:exec`, so behaviour is proven against real Firestore transactions.

If Java is still missing when D-agents start, agents can only use `npm test`. The app's dev server fails fast with "Start the emulators: `npm run emulators`" and never falls back to memory. The guard is in `src/server/firebase/admin.ts`.

### 1.2 Guard rules (`src/server/db/index.ts`)
- `getDocStore()` returns the store injected by tests, if one was set. The setter `setDocStoreForTests()` throws unless `process.env.VITEST === "true"`.
- Otherwise it returns a `FirestoreDocStore` built from `getAdminApp()`.
- `getAdminApp()` checks two things:
  - It throws if `NODE_ENV === "production"` while `FIRESTORE_EMULATOR_HOST` is set.
  - It throws if `NODE_ENV !== "production"` and there is neither an emulator host nor credentials (with the message above).
- The admin app uses project id `demo-taki` when the emulator is in use. The `demo-` prefix means the SDK can never reach a real project.

### 1.3 Scripts to add (D5 owns `package.json`)

```jsonc
"emulators": "firebase emulators:start --only firestore,storage --project demo-taki --import=.data/emulators --export-on-exit",
"seed": "tsx --conditions=react-server --env-file-if-exists=.env.local scripts/seed.ts",
"ops": "tsx --conditions=react-server --env-file-if-exists=.env.local scripts/ops.ts",
"sweep": "tsx --conditions=react-server --env-file-if-exists=.env.local scripts/sweep.ts",
"test:emulator": "firebase emulators:exec --only firestore,storage --project demo-taki \"vitest run --config vitest.emulator.config.mts\"",
"rules:deploy": "firebase deploy --only firestore:rules,firestore:indexes,storage"
```

`--conditions=react-server` makes `import "server-only"` resolve to its empty module outside Next. Add `server-only` as an explicit dependency so this resolution works in `tsx`. Vitest already aliases it.

Files at the repo root (D5):
- `firebase.json`: firestore rules and indexes, storage rules, and emulators (firestore 8080, storage 9199, ui 4000, `singleProjectMode: true`).
- `.firebaserc`: `{ "projects": { "default": "demo-taki" } }`.
- Add `.data/` to `.gitignore`.

`.env.development` (committed, no secrets) holds:
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`
- `FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199`
- `FIREBASE_PROJECT_ID=demo-taki`
- `FIREBASE_STORAGE_BUCKET=demo-taki.appspot.com`
- `SMS_PROVIDER=dev`
- `PAYMENT_PROVIDER=dev`

Secrets go in `.env.local`. In dev only, a missing `SESSION_SECRET` is generated per process with a console warning (dev convenience); production refuses to start without it.

Playwright `webServer` becomes `npm run build && npm run start -- -p 3100`, with emulator env and `reuseExistingServer`. The emulators are started by `firebase emulators:exec` around the Playwright command (`test:e2e` script), then `npm run seed -- --reset`.

---

## 2. Persistence layer

### 2.1 DocStore interface (`src/server/db/docstore.ts`, D5)

A thin, Firestore-shaped abstraction. Repositories are written **once** against it, so tests exercise real repository code.

```ts
import "server-only";
export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains" | "array-contains-any";
export type Where = readonly [field: string, op: WhereOp, value: unknown];
export interface QuerySpec {
  where?: readonly Where[];
  orderBy?: ReadonlyArray<readonly [field: string, dir: "asc" | "desc"]>;
  limit?: number;
  startAfter?: readonly unknown[];          // values of orderBy fields (+ id tiebreak) — cursor pagination
}
/** Collection path: "bookings" or a subcollection "bookings/TAKI123456/events". */
export type ColPath = string;

export interface TxContext {
  // READS — must all happen before the first write (Firestore rule; MemoryDocStore enforces it too)
  get<T>(col: ColPath, id: string): Promise<T | null>;
  getMany<T>(col: ColPath, ids: readonly string[]): Promise<Array<T | null>>;
  query<T>(col: ColPath, q: QuerySpec): Promise<T[]>;
  // WRITES — buffered, applied atomically on commit
  create<T>(col: ColPath, id: string, data: T): void;      // fails the tx if it exists
  set<T>(col: ColPath, id: string, data: T): void;
  update(col: ColPath, id: string, patch: Record<string, unknown>): void; // dotted paths allowed; no FieldValue
  delete(col: ColPath, id: string): void;
}

export interface DocStore {
  readonly kind: "firestore" | "memory";
  get<T>(col: ColPath, id: string): Promise<T | null>;
  getMany<T>(col: ColPath, ids: readonly string[]): Promise<Array<T | null>>;
  query<T>(col: ColPath, q: QuerySpec): Promise<T[]>;
  count(col: ColPath, q: QuerySpec): Promise<number>;                 // aggregate count()
  sum(col: ColPath, field: string, q: QuerySpec): Promise<number>;    // aggregate sum()
  runTransaction<T>(fn: (tx: TxContext) => Promise<T>, opts?: { maxAttempts?: number }): Promise<T>; // default 5
  batchWrite(ops: Array<{ op: "set" | "create" | "update" | "delete"; col: ColPath; id: string; data?: unknown }>): Promise<void>; // seed/append-only
}
```

Rules every repository follows:
- Timestamps are **ISO-8601 UTC strings** (`IsoDateTime`), generated server-side from the injected clock. They are not Firestore `Timestamp`s. This keeps the domain types, the memory store and the JSON responses identical, and ISO strings sort correctly.
- Money is integer **rupees** in pricing (as in Phase 1) and integer **paise** in payments (gateway precision).
- No `FieldValue` sentinels. Every mutation is read-modify-write inside a transaction, which keeps the two stores equivalent.
- Every document carries `id`, `createdAt` and `updatedAt`. Mutable aggregates carry `version: number` (incremented on each write, useful for debugging and for ETags).

`MemoryDocStore` (`tests/support/memory-docstore.ts`, D5):
- Deep-clones on every read and write.
- Supports every `WhereOp` and `orderBy` with `startAfter`.
- Uses **optimistic concurrency**: each read in a transaction records the document version. At commit it re-checks those versions and retries the transaction up to `maxAttempts` if any changed. This reproduces Firestore's "a conflicting transaction retries" behaviour, which the concurrency tests rely on.
- Enforces reads-before-writes.
- Optionally checks every multi-field query against `firestore.indexes.json` and throws `missing_index`, so missing indexes are caught without the emulator.

`FileStore` (`src/server/files/filestore.ts`, D5):

```ts
export interface FileStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(path: string): Promise<void>;
}
```
`FirebaseStorageFileStore` (admin `getStorage().bucket()`) handles the emulator and production. `MemoryFileStore` lives in `tests/support/`.

### 2.2 Firebase admin init (`src/server/firebase/admin.ts`, D5)
- `initializeApp` happens once, guarded by `getApps()`.
- Credentials come from the three fields `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (with `\n` unescaped), or from `GOOGLE_APPLICATION_CREDENTIALS`. Neither is needed with the emulator.
- `getFirestore().settings({ ignoreUndefinedProperties: true })` is called once, guarded on `globalThis` for HMR.
- `firebase-admin` is in Next's default `serverExternalPackages` list, so no config change is needed.

---

## 3. Authentication, sessions, roles

### 3.1 Firebase Auth vs server sessions

Server sessions are the chosen option. The comparison:

| Concern | Firebase Auth | Server sessions (chosen) |
|---|---|---|
| "Dev OTP" shown on screen, labelled | Not possible. Google generates and sends codes; dev only offers fixed test numbers. | Server generates the code, so dev returns it as `devOtp`. |
| Password + phone OTP combination | Awkward (phone provider + email/password linking with fake emails) | Native |
| SMS provider choice (DLT-compliant Indian provider) | Locked to Google SMS pricing and regions | `SmsProvider` adapter via env |
| Client SDK + reCAPTCHA | Required (`firebase` SDK, reCAPTCHA on every OTP) | None |
| Rate limits / attempt limits under our control | Partially | Fully |
| Mobile app later | Native | Same HTTP API with a session cookie or a bearer session token (same `sessions` collection). `createCustomToken` can be added later if mobile ever needs direct Firestore access. |

### 3.2 Roles and accounts
- `Role = "customer" | "agency" | "driver"`.
- One `users` document per account. A phone number may hold **one account per role** (an agency owner can also be a customer). Uniqueness is enforced by `phoneIndex/{role}:{e164}`, created in the signup transaction (`tx.create` fails on a duplicate).
- Profile documents: `customers/{userId}`, `drivers/{userId}`, `agencies/{agencyId}`. An agency has `ownerUserId`, and `users.agencyId` points back, which leaves room for more staff users later.
- Login is per role (`/auth/login?role=agency`), with separate signup pages per role (P3/D1 UI).

### 3.3 Passwords (`src/server/auth/passwords.ts`, D1)
- Hashing uses `node:crypto` `scrypt`, which needs no native dependency. Parameters: `N = 2^15`, `r = 8`, `p = 1`, `keylen = 64`, `maxmem = 64 MiB`, and a 16-byte random salt.
- Stored format: `scrypt$v1$32768$8$1$<saltB64url>$<hashB64url>`.
- Verification uses `timingSafeEqual`. If the stored params differ from the current ones, the password is rehashed on the next successful login.
- For an unknown phone, verification runs against a constant dummy hash to equalize timing.
- Policy: 8–64 characters, at least 1 letter and 1 digit (`LIMITS.password`), and the password must not equal the phone number.
- Lockout reuses `LOGIN_LOCK`: after 5 consecutive failures the account locks for 15 minutes (`users.failedLoginCount`, `users.lockedUntil`). The error message is always generic: *"Phone number or password is incorrect."*

### 3.4 OTP (`src/server/auth/otp.ts`, D1)

Purposes: `signup` | `reset_password` | `change_phone`.

| Rule | Value |
|---|---|
| Code | 6 digits from `crypto.randomInt(0, 1_000_000)`, zero-padded |
| Storage | `codeHash = HMAC-SHA256(OTP_KEY, challengeId + ":" + code)`. `OTP_KEY` is derived from `SESSION_SECRET` with HKDF, info `"taki-otp-v1"`. Plaintext is never stored. |
| Expiry | 5 min (`OTP.expirySeconds`) |
| Attempts | 5 per challenge, **cumulative across resends**. The 6th attempt returns `too_many_attempts` and the challenge is dead. |
| Resend | 30 s cooldown, at most 3 resends per challenge. A resend generates a new code and invalidates the old one. |
| Rate limits | Per phone: 5 challenges/hour and 10/day. Per IP: 20 challenges/hour. Verify per IP: 60/hour. See §3.9. |
| Proof | A successful verify returns a one-time `proofToken` (32 random bytes, base64url). The challenge stores `proofHash = sha256(token)` and `proofExpiresAt` (+15 min). Signup, reset and phone change **consume** the proof inside their transaction (`consumedAt`). |
| Enumeration | `signup` reveals "already registered — log in" (deliberate UX trade-off). `reset_password` for an unknown phone returns the same shape, sends nothing and never verifies. |
| Dev OTP | When `SMS_PROVIDER=dev`, the response includes `devOtp: { code, label: "Dev OTP" }`. `SMS_PROVIDER=dev` together with `NODE_ENV=production` fails at boot. |

SMS adapter (`src/server/auth/sms/*`, D1):

```ts
export interface SmsProvider {
  readonly name: "dev" | "msg91";
  sendOtp(input: { to: Mobile; code: string; purpose: OtpPurpose; expiresInMinutes: number }): Promise<{ messageId: string; devCode?: string }>;
  sendText(input: { to: Mobile; templateId: string; vars: Record<string, string> }): Promise<{ messageId: string }>;
}
```
- `dev` returns `devCode` and logs nothing sensitive.
- `msg91` posts to the MSG91 OTP/Flow API with a DLT template (`MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER_ID`). It fails closed (`sms_not_configured`, 503) when keys are missing.

### 3.5 Sessions (`src/server/auth/sessions.ts` + `session-cookie.ts`, D1)
- **Session id:** 32 random bytes, base64url. Firestore stores `sessions/{sha256(sid)}`; the raw id is never stored.
- **Cookie:** name `__Host-taki_session` in production and `taki_session` in dev (http). Attributes: `HttpOnly`, `Secure` (prod), `SameSite=Lax`, `Path=/`, `Max-Age = 7 days` (`SESSION_TTL_DAYS`).
- **Cookie value:** `base64url(JSON{ sid, r: role, exp })` + `"."` + `base64url(HMAC-SHA256(SESSION_SECRET, payload))`.
  - The signature lets `proxy.ts` do a **cheap optimistic check** (role and expiry) with no database call, as the Next 16 proxy docs recommend.
  - The Firestore record makes sessions **revocable**. Each handler does the authoritative check.
  - `session-cookie.ts` uses **Web Crypto** (`crypto.subtle`) only, so it is runtime-agnostic and importable from `proxy.ts`.
- **Authoritative check (`requireSession(role?)`):**
  - verify the HMAC,
  - load `sessions/{hash}` and confirm it is not revoked and not expired,
  - load `users/{id}` and confirm `status: "active"` and the role matches,
  - then return `{ user, session, profileId, agencyId? }`.
  - The result is memoised per request with React `cache()`.
- **Sliding renewal:** when under 24 h remains, a mutating handler re-issues the cookie with a new `exp` and updates `sessions.expiresAt`. Renewal is capped at 30 days from `createdAt`.
- **Revocation:**
  - logout revokes the current session;
  - password reset revokes all sessions for the user;
  - password change and phone change revoke all **other** sessions.
- **Session-fixation:** a fresh sid is issued on every login or signup.

### 3.6 CSRF and origin
- SameSite=Lax cookies.
- **Every non-GET `/api/**` handler** checks that `Origin` (or `Referer`) matches `APP_ORIGIN`. The check lives in the handler wrapper.
- JSON endpoints also require `Content-Type: application/json`.
- The Cashfree webhook and the cron endpoint are exempt; they authenticate by signature and by bearer secret respectively.

### 3.7 `src/proxy.ts` (D1)
Next 16 renamed middleware to proxy. The file lives at `src/proxy.ts` (same level as `app/`). It runs in the Node runtime by default, but it uses only Web APIs anyway. Per the docs, the proxy is an **optimistic** gate only; every handler re-authorizes.

```ts
export const config = { matcher: ["/customer/:path*", "/agency/:path*", "/driver/:path*", "/auth/:path*", "/signup/:path*"] };
```

| Path | No / invalid cookie | Wrong role | OK |
|---|---|---|---|
| `/customer/**` | 307 → `/auth/login?role=customer&next=<path>` | 307 → that role's home | next |
| `/agency/**` | → `/auth/login?role=agency&next=…` | 307 → role home | next. Unverified agencies are **not** blocked here; pages show a banner and publishing is blocked server-side. |
| `/driver/**` | → `/auth/login?role=driver&next=…` | 307 → role home | next |
| `/auth/login`, `/signup/**` | next | — | Signed in → role home (unless `?switch=1`) |

`next` is validated with the existing safe-redirect helper (relative path only). `/api/**` is **not** in the matcher; handlers authenticate themselves.

> **Route naming assumption (for P3 and the orchestrator):** today's `/driver/*` pages are the owner-operator UI. In v2 they move to `/agency/*`, and `/driver/*` becomes the new mobile-first driver app. The proxy table above assumes this.

### 3.8 Agency verification and driver linking

Agency verification, `agencies.verification.status`:

| State | How it is entered | Agency can |
|---|---|---|
| `pending` | Signup with the required documents (ID document + photo) | Log in, add vehicles, add or invite drivers, create **draft** trips |
| `verified` | `npm run ops -- agency:verify <agencyId>`. In non-production, `DEV_AUTO_VERIFY_AGENCIES=true` verifies at signup, so e2e is not blocked. | Everything, including **publish trip** |
| `rejected` (reason) | `npm run ops -- agency:reject <id> --reason "…"` | Same as pending, plus re-upload documents. `POST /api/agency/verification` moves it back to `pending`. |

**Gate:** `publishTrip`, and accepting bookings, require `verified`. Error `agency_not_verified` (403).

Driver to agency link, `drivers.agencyLink`:
- **Invite path:** the agency posts `driverInvites` with `{ phone, fullName }`, valid for 14 days. When a driver signs up with that phone, the signup form shows "Invited by X". On submit, the link is `active` immediately (`via: "invite"`).
- **Request path:** at signup the driver picks a **verified** agency from `GET /api/public/agencies?q=`. The link becomes `pending` and the agency approves or rejects it on its Drivers page (link becomes `active` or `rejected`).
- **Remove:** the agency removes a driver, setting the link to `removed`. This is blocked with `driver_has_active_trips` if the driver is assigned to any `published` or `in_progress` trip.
- A rejected or removed driver may request a link again (`POST /api/driver/agency-link`).
- **Assignment** to a trip requires: link `active`, user `active`, `availability: "available"` (agency-set), and **no schedule overlap** (§6.4).
- An agency can see its linked drivers' documents (masked numbers and file view). Customers never can.

### 3.9 Rate limits (`src/server/http/rate-limit.ts`, D5)

Fixed-window counters in `rateLimits/{sha256(bucket)}` as `{ count, windowStart, expiresAt }`, incremented in a transaction. A breach returns 429 `rate_limited` with `Retry-After`. The IP comes from the first `x-forwarded-for` hop only when `TRUST_PROXY_HEADERS=true` (Vercel); otherwise it is `"local"`.

| Bucket | Limit |
|---|---|
| `otp:send:phone:{e164}` | 5 / h, 10 / day |
| `otp:send:ip:{ip}` | 20 / h |
| `otp:verify:ip:{ip}` | 60 / h |
| `login:ip:{ip}` | 30 / 15 min (plus the per-account lockout) |
| `booking:create:user:{id}` | 30 / h |
| `payment:create:user:{id}` | 20 / h |
| `upload:user:{id}` | 60 / h |

---

## 4. Firestore data model

Shared types live in `src/lib/domain/types.ts` (v2 rewrite, D5, framework-free). Document shapes live in `src/server/db/schema.ts` (D5). Below, `Id` is `"<prefix>_<20 base32 chars>"` from `crypto.randomBytes`. `BookingId` stays `TAKI` + 6 digits (customer-facing); collisions are checked in the transaction.

### 4.1 Common types

```ts
export type Role = "customer" | "agency" | "driver";
export type StateCode = "TN" | "KL" | "KA" | "TG" | "AP";
export type DistrictId = string;                 // slug from src/lib/domain/places/districts.ts
export type PlaceId = string;                    // hub town slug (each belongs to one district)
export type GoodsCategory = "general_goods" | "agriculture" | "construction" | "industrial"
  | "electronics" | "furniture" | "textiles" | "perishables" | "other";
export type PackageType = "box" | "bag" | "sack" | "crate" | "pallet" | "loose" | "other";
export type SpecialHandling = "fragile" | "keep_dry" | "this_side_up" | "temperature_sensitive";
export type VehicleClass = "Mini Truck" | "Pickup" | "Light Truck" | "Medium Truck" | "Heavy Truck"; // existing
export type BodyType = "open" | "tarpaulin" | "closed" | "container";
export type VehicleCountRange = "1-5" | "6-10" | "11-25" | "26-50" | "50+";

export interface Address {
  line1: string; line2?: string; landmark?: string;
  districtId: DistrictId; districtName: string; state: StateCode; pincode: string; // /^[1-9]\d{5}$/
  location?: { lat: number; lng: number };      // only when the user chose "current location"
  source: "manual" | "current_location";
}
export interface FileRef { fileId: Id }          // -> files/{fileId}
```

### 4.2 Collections

| Collection | Doc id | Purpose / notes |
|---|---|---|
| `users` | `usr_*` | Credentials and role. **Never returned to clients raw.** |
| `phoneIndex` | `{role}:{e164}` | Uniqueness. `{ userId }` |
| `sessions` | sha256(sid) | `{ userId, role, createdAt, expiresAt, lastSeenAt, revokedAt?, userAgentHash, ipHash }` |
| `otpChallenges` | `otp_*` | §3.4 |
| `rateLimits` | sha256(bucket) | §3.9. A TTL policy on `expiresAt` in production. |
| `customers` | = userId | Customer profile |
| `agencies` | `agc_*` | Agency profile and verification |
| `drivers` | = userId | Driver profile and agency link |
| `driverInvites` | `inv_*` | Agency → phone invites |
| `vehicles` | `veh_*` | Owned by an agency |
| `registrationIndex` | normalized reg no. | Uniqueness of vehicle registration |
| `schedules` | `driver:{id}` / `vehicle:{id}` | Busy intervals. Per-driver and per-vehicle lock document (§6.4). |
| `trips` | `trp_*` | Trip with **embedded ordered checkpoints** (bounded, ≤ 10) and a capacity `holds` map |
| `trips/{id}/events` | `tev_*` | Checkpoint arrival and departure, trip start and complete (append-only) |
| `shipments` | `shp_*` | Customer's package, addresses and receiver (the "draft" that is searched) |
| `bookings` | `TAKI######` | Booking state (the single source of truth for status), with denormalized list fields |
| `bookings/{id}/events` | `bev_*` | Booking timeline and driver remarks (append-only) |
| `bookingSecrets` | = bookingId | Pickup and delivery OTPs plus attempt counters. Read **only** by customer projections and driver verification. |
| `payments` | `pay_*` (= gateway `order_id`) | Payment attempts and refunds |
| `paymentEvents` | sha256(provider event key) | Webhook dedupe |
| `idempotency` | `{scope}:{userId}:{key}` | Stored result for replayed POSTs, with a 24 h TTL |
| `reviews` | = bookingId | One per delivered booking |
| `earnings` | = bookingId | Agency earning per delivered booking (settlement unit) |
| `settlements` | `stl_*` | Payout batches recorded by ops with a bank reference |
| `notifications` | `ntf_*` | In-app notifications |
| `files` | `fil_*` | Metadata for every uploaded file (Storage path, owner, kind, visibility) |
| `jobs` | `job_*` | Outbox: refunds, SMS. `{ type, payload, status, attempts, nextAttemptAt, lastError? }` |

### 4.3 Document interfaces (`src/server/db/schema.ts`)

```ts
interface Base { id: string; createdAt: IsoDateTime; updatedAt: IsoDateTime }

export interface UserDoc extends Base {
  role: Role; phone: Mobile; phoneVerifiedAt: IsoDateTime;
  passwordHash: string; passwordChangedAt: IsoDateTime;
  status: "active" | "disabled";
  failedLoginCount: number; lockedUntil: IsoDateTime | null; lastLoginAt: IsoDateTime | null;
  agencyId: Id | null;                               // role === "agency"
}

export interface CustomerDoc extends Base {
  fullName: string; dob: IsoDate;                    // 18+ at signup (IST)
  phone: Mobile; photo: FileRef | null;
  stats: { bookings: number; delivered: number };
}

export interface AgencyDoc extends Base {
  ownerUserId: Id; ownerName: string;
  agencyName: string; nameLower: string; searchTokens: string[];
  districtId: DistrictId; state: StateCode; statesCovered: StateCode[]; vehicleCountRange: VehicleCountRange;
  phone: Mobile; photo: FileRef | null;
  identityDocument: { kind: "aadhaar" | "pan" | "driving_license"; numberMasked: string; numberHmac: string; file: FileRef };
  verification: { status: "pending" | "verified" | "rejected"; submittedAt: IsoDateTime; reviewedAt: IsoDateTime | null; reason: string | null };
  stats: { vehicles: number; drivers: number; ratingAvg: number; ratingCount: number; delivered: number };
}

export interface DriverDoc extends Base {
  fullName: string; phone: Mobile; photo: FileRef;
  license: { numberMasked: string; numberHmac: string; file: FileRef; validUntil: IsoDate | null };
  aadhaar: { numberMasked: string; numberHmac: string; file: FileRef };
  agencyLink: { agencyId: Id; agencyName: string; status: "pending" | "active" | "rejected" | "removed";
                via: "invite" | "request"; requestedAt: IsoDateTime; decidedAt: IsoDateTime | null } | null;
  availability: "available" | "unavailable";        // agency-controlled
  stats: { ratingAvg: number; ratingCount: number; delivered: number };
}

export interface DriverInviteDoc extends Base {
  agencyId: Id; agencyName: string; phone: Mobile; fullName: string;
  status: "pending" | "accepted" | "revoked" | "expired"; expiresAt: IsoDateTime; driverId: Id | null;
}

export interface VehicleDoc extends Base {
  agencyId: Id; vehicleClass: VehicleClass; modelId: VehicleModelId | null; makeModel: string;
  registrationNumber: string;                        // normalized "TN 37 XX 4587"
  maxPayloadKg: number; bodyType: BodyType;
  dimensionsFt: { length: number; width: number; height: number } | null;
  acceptedGoods: GoodsCategory[]; handlingSupported: SpecialHandling[];
  photos: FileRef[]; imageKey: VehicleImageKey;      // illustrative fallback when no photo
  status: "active" | "inactive" | "removed";
}

export interface TripCheckpoint {
  index: number;                                     // 0 = origin, last = destination
  placeId: PlaceId; placeName: string; districtId: DistrictId; districtName: string; state: StateCode;
  kmFromOrigin: number;
  expectedArrivalAt: IsoDateTime | null;             // null for origin
  expectedDepartureAt: IsoDateTime | null;           // null for destination
  actualArrivalAt: IsoDateTime | null; actualDepartureAt: IsoDateTime | null;
}

export interface CapacityHold { kg: number; kind: "unpaid" | "paid"; dueAt: IsoDateTime | null } // dueAt only for unpaid

export interface TripDoc extends Base {
  agencyId: Id; agencyName: string;
  vehicleId: Id; vehicle: { vehicleClass: VehicleClass; makeModel: string; registrationNumber: string; bodyType: BodyType; photo: FileRef | null; imageKey: VehicleImageKey };
  driverId: Id; driver: { fullName: string; photo: FileRef | null; ratingAvg: number; ratingCount: number };
  status: "draft" | "published" | "in_progress" | "completed" | "cancelled";
  checkpoints: TripCheckpoint[];                     // 2..10, ordered, distinct districts not required
  departureAt: IsoDateTime; arrivalAt: IsoDateTime; distanceKm: number;
  capacity: { vehicleMaxKg: number; offeredKg: number };
  holds: Record<BookingId, CapacityHold>;            // §6 — the ONLY capacity ledger
  goods: { accepted: GoodsCategory[]; handlingSupported: SpecialHandling[]; maxPackageKg: number | null; notes: string | null };
  rates: { perKmPaise: number; perKgPaise: number; handlingFeeRupees: number };
  pickupKeys: string[];                              // `${districtId}|${istDate}` per pickup-able checkpoint (§7.2)
  progress: { lastCheckpointIndex: number | null; lastEventAt: IsoDateTime | null };
  counts: { awaiting: number; held: number; delivered: number };
  publishedAt: IsoDateTime | null; startedAt: IsoDateTime | null; completedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null; cancelReason: string | null;
  version: number;
}

export interface ShipmentDoc extends Base {
  customerId: Id;
  source: Address; destination: Address;
  receiver: { name: string; phone: Mobile };
  package: { weightKg: number; goodsCategory: GoodsCategory; packageType: PackageType; description: string;
             pieces: number; specialHandling: SpecialHandling[]; declaredValueRupees: number | null };
  shippingDate: IsoDate;
  status: "open" | "booked" | "completed" | "withdrawn";
  currentBookingId: BookingId | null;                // the ONE non-terminal booking (duplicate guard)
  bookingIds: BookingId[];
}

export type BookingStatus =
  | "awaiting_agency" | "pending_payment" | "payment_failed" | "confirmed"
  | "picked_up" | "in_transit" | "out_for_delivery" | "delivered" | "rejected" | "cancelled";
export type CustomerTab = "pending" | "confirmed" | "picked_up" | "in_transit" | "delivered" | "rejected" | "cancelled";
export type Actor = { role: Role | "system"; userId: Id | null };
export type RejectReason = "agency_rejected" | "no_response_before_departure" | "trip_cancelled";
export type CancelReason = "customer_cancelled" | "payment_window_expired" | "trip_cancelled" | "pickup_refused";

export interface PricingBreakdownV2 {
  pricingVersion: 2;
  distanceKm: number; weightKg: number; ratePerKmPaise: number; ratePerKgPaise: number;
  distanceCharge: Rupees; weightCharge: Rupees; transportationCharge: Rupees;  // agency gross
  handlingFee: Rupees; serviceFee: Rupees; totalPayable: Rupees;
  lines: Array<{ code: "distance" | "weight" | "handling" | "service_fee"; label: string; amount: Rupees }>;
}

export interface BookingDoc extends Base {
  shipmentId: Id; tripId: Id; customerId: Id; agencyId: Id; driverId: Id; vehicleId: Id;
  status: BookingStatus; tab: CustomerTab;
  pickup: { checkpointIndex: number; districtId: DistrictId; placeName: string; expectedDepartureAt: IsoDateTime };
  drop:   { checkpointIndex: number; districtId: DistrictId; placeName: string; expectedArrivalAt: IsoDateTime };
  weightKg: number; goodsCategory: GoodsCategory;
  pricing: PricingBreakdownV2;                       // quote at request; re-locked at accept
  respondBy: IsoDateTime;                            // pickup.expectedDepartureAt - sameDayLeadMinutes
  paymentDueAt: IsoDateTime | null; paidAt: IsoDateTime | null; paymentId: Id | null;
  statusHistory: Array<{ status: BookingStatus; at: IsoDateTime; by: Actor; note?: string }>; // ≤ ~12 entries
  rejection: { reason: RejectReason; note: string | null; at: IsoDateTime } | null;
  cancellation: { reason: CancelReason; note: string | null; at: IsoDateTime; by: Actor } | null;
  reviewed: boolean;
  // list denormalization (written once, refreshed on profile edits only where noted)
  display: { customerName: string; agencyName: string; routeLabel: string; tripDepartureAt: IsoDateTime; vehicleReg: string; driverName: string };
  searchTokens: string[];                            // agency History search (§8.4)
  version: number;
}

export interface BookingSecretsDoc { id: BookingId; pickupOtp: string; deliveryOtp: string; pickupAttempts: number; deliveryAttempts: number; issuedAt: IsoDateTime }

export type TrackingEventType =
  | "requested" | "accepted" | "rejected" | "payment_succeeded" | "payment_failed" | "confirmed" | "cancelled"
  | "picked_up" | "in_transit" | "checkpoint_arrived" | "checkpoint_departed" | "out_for_delivery"
  | "delivered" | "delivery_proof_added" | "remark";
export interface BookingEventDoc { id: Id; bookingId: BookingId; type: TrackingEventType; at: IsoDateTime; clientAt: IsoDateTime | null;
  actor: Actor; checkpointIndex: number | null; placeName: string | null; remarks: string | null; files: FileRef[] }
export interface TripEventDoc { id: Id; tripId: Id; type: "started" | "checkpoint_arrived" | "checkpoint_departed" | "completed" | "cancelled";
  checkpointIndex: number | null; at: IsoDateTime; clientAt: IsoDateTime | null; actor: Actor; remarks: string | null }

export type PaymentStatus = "created" | "pending" | "succeeded" | "failed" | "cancelled" | "refund_pending" | "refunded" | "refund_failed";
export interface PaymentDoc extends Base {
  bookingId: BookingId; customerId: Id; agencyId: Id;
  provider: "dev" | "cashfree"; providerEnv: "dev" | "sandbox" | "production";
  amountPaise: number; currency: "INR"; status: PaymentStatus; idempotencyKey: string;
  providerOrderId: string;                           // == id
  checkout: { paymentSessionId?: string; devTokenHash?: string } ; expiresAt: IsoDateTime;
  providerPaymentId: string | null; methodLabel: string | null;  // masked, from gateway
  confirmation: { source: "webhook" | "verify" | "dev_confirm"; at: IsoDateTime; providerStatus: string } | null;
  failureReason: string | null;
  refund: { refundId: string; amountPaise: number; reason: string; status: "pending" | "succeeded" | "failed";
            requestedAt: IsoDateTime; completedAt: IsoDateTime | null; providerRefundId: string | null } | null;
}

export interface ReviewDoc extends Base { bookingId: BookingId; customerId: Id; customerFirstName: string; driverId: Id; agencyId: Id; tripId: Id; rating: 1 | 2 | 3 | 4 | 5; comment: string | null }

export interface EarningDoc extends Base {
  bookingId: BookingId; agencyId: Id; tripId: Id; driverId: Id;
  customerPaid: Rupees; transportationCharge: Rupees; handlingFee: Rupees; platformFee: Rupees;
  agencyNet: Rupees;                                 // transportationCharge + handlingFee
  deliveredAt: IsoDateTime; status: "pending" | "settled" | "on_hold"; settlementId: Id | null; settledAt: IsoDateTime | null;
}
export interface SettlementDoc extends Base { agencyId: Id; amount: Rupees; earningIds: BookingId[]; reference: string; settledAt: IsoDateTime; recordedBy: "ops" }

export type NotificationKind =
  | "booking_requested" | "booking_accepted" | "booking_rejected" | "booking_expired" | "booking_cancelled"
  | "payment_succeeded" | "payment_failed" | "payment_refunded"
  | "shipment_assigned" | "pickup_confirmed" | "checkpoint_reached" | "out_for_delivery" | "delivered"
  | "review_received" | "trip_cancelled"
  | "agency_verified" | "agency_rejected" | "driver_link_requested" | "driver_link_decided" | "driver_invited";
export interface NotificationDoc { id: Id; userId: Id; role: Role; kind: NotificationKind; title: string; body: string;
  link: { type: "booking" | "trip" | "driver" | "profile"; id: string } | null; createdAt: IsoDateTime; readAt: IsoDateTime | null }

export type FileKind = "aadhaar" | "pan" | "driving_license" | "profile_photo" | "vehicle_photo" | "delivery_proof";
export interface FileDoc extends Base {
  ownerType: "customer" | "agency" | "driver" | "vehicle" | "booking"; ownerId: string; uploadedBy: Id;
  kind: FileKind; storagePath: string;               // private/{ownerType}/{ownerId}/{kind}/{fileId}.{ext}
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"; sizeBytes: number; sha256: string;
  status: "active" | "replaced" | "deleted"; sample: boolean; // sample=true only for seed files
}
```

**Document numbers:**
- Aadhaar is 12 digits with a Verhoeff check, masked as `XXXX XXXX 1234`.
- PAN matches `^[A-Z]{5}\d{4}[A-Z]$`, masked as `XXXXXX234F`.
- A driving licence is normalized alphanumeric, 10–20 characters, masked to its last 4.
- `numberHmac = HMAC-SHA256(PII_HASH_KEY, normalized)` is used only to flag the same document reused across accounts. The full number is **never stored**.

### 4.4 Field visibility by role (projection functions in `src/server/views/*`)

| Data | Customer (owner) | Agency | Driver (assigned) |
|---|---|---|---|
| Shipment districts, pincode, weight, goods, description, date | ✓ | ✓ from request | ✓ from `confirmed` |
| Full pickup and drop address | ✓ | ✓ from `pending_payment` (accepted) | ✓ from `confirmed` |
| Customer name, phone | ✓ | name at request; phone from `pending_payment` | from `confirmed` |
| Receiver name, phone | ✓ | from `confirmed` | from `confirmed` |
| Driver name, photo, rating | rating and agency at search; **name, photo, vehicle reg from `pending_payment`**; driver phone from `confirmed` | ✓ | self |
| Pricing breakdown | ✓ | ✓ | ✗ (weight and pieces only) |
| Pickup and delivery OTP | ✓ from `confirmed` (delivery OTP to share with the receiver) | ✗ | ✗ (enters it) |
| Identity documents (Aadhaar/PAN/DL) | ✗ | own documents; **linked drivers' documents** (masked plus file view) | own |
| Delivery proof files | ✓ | ✓ | ✓ |

Each role has its own view function: `toCustomerBookingView`, `toAgencyBookingView` and `toDriverShipmentView`. They are the **only** code that turns documents into JSON. No handler returns a raw document.

### 4.5 Composite indexes (`firestore.indexes.json`, D5 owns; others request additions)

```jsonc
{
  "indexes": [
    { "collectionGroup": "trips", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "pickupKeys", "arrayConfig": "CONTAINS" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "departureAt", "order": "ASCENDING" } ] },
    { "collectionGroup": "trips", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "departureAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "trips", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "driverId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "departureAt", "order": "ASCENDING" } ] },
    { "collectionGroup": "trips", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "vehicleId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "departureAt", "order": "ASCENDING" } ] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "customerId", "order": "ASCENDING" }, { "fieldPath": "tab", "order": "ASCENDING" }, { "fieldPath": "updatedAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "customerId", "order": "ASCENDING" }, { "fieldPath": "updatedAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "searchTokens", "arrayConfig": "CONTAINS" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "tripId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" } ] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "driverId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "updatedAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "respondBy", "order": "ASCENDING" } ] },
    { "collectionGroup": "bookings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "paymentDueAt", "order": "ASCENDING" } ] },
    { "collectionGroup": "shipments", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "customerId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "payments", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "customerId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "payments", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "payments", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "bookingId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "notifications", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "userId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "notifications", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "userId", "order": "ASCENDING" }, { "fieldPath": "readAt", "order": "ASCENDING" } ] },
    { "collectionGroup": "reviews", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "driverId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "reviews", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "earnings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "deliveredAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "earnings", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "deliveredAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "vehicles", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "drivers", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyLink.agencyId", "order": "ASCENDING" }, { "fieldPath": "agencyLink.status", "order": "ASCENDING" }, { "fieldPath": "fullName", "order": "ASCENDING" } ] },
    { "collectionGroup": "driverInvites", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "agencyId", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "driverInvites", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "phone", "order": "ASCENDING" }, { "fieldPath": "status", "order": "ASCENDING" } ] },
    { "collectionGroup": "agencies", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "verification.status", "order": "ASCENDING" }, { "fieldPath": "nameLower", "order": "ASCENDING" } ] },
    { "collectionGroup": "jobs", "queryScope": "COLLECTION", "fields": [
      { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "nextAttemptAt", "order": "ASCENDING" } ] }
  ],
  "fieldOverrides": [
    { "collectionGroup": "bookings", "fieldPath": "statusHistory", "indexes": [] },
    { "collectionGroup": "bookings", "fieldPath": "pricing", "indexes": [] },
    { "collectionGroup": "trips", "fieldPath": "checkpoints", "indexes": [] },
    { "collectionGroup": "trips", "fieldPath": "holds", "indexes": [] },
    { "collectionGroup": "sessions", "fieldPath": "expiresAtTs", "ttl": true, "indexes": [] },
    { "collectionGroup": "rateLimits", "fieldPath": "expiresAtTs", "ttl": true, "indexes": [] },
    { "collectionGroup": "idempotency", "fieldPath": "expiresAtTs", "ttl": true, "indexes": [] },
    { "collectionGroup": "otpChallenges", "fieldPath": "expiresAtTs", "ttl": true, "indexes": [] }
  ]
}
```

Note on TTL: expiry is always enforced in code via the ISO `expiresAt` field. TTL is only storage hygiene, and TTL policies require a Firestore `Timestamp`. So, as the **one exception to the ISO rule**, these four collections also store `expiresAtTs: Timestamp`. The emulator ignores TTL, and MemoryDocStore treats the field as opaque.

### 4.6 Security rules

`firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }   // Admin SDK only (bypasses rules)
  }
}
```

`storage.rules`:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o { match /{allPaths=**} { allow read, write: if false; } }
}
```

### 4.7 Uploads (`src/server/files/*`, D5)
- Route handlers accept `multipart/form-data` (`await request.formData()`). They reject a `Content-Length` over 20 MB before parsing.
- Per-file limits: identity documents 5 MB (JPEG, PNG, WEBP or PDF); photos 5 MB (JPEG, PNG or WEBP); delivery proof 8 MB each, up to 3 files.
- The type is checked by **magic bytes**, not by the client's MIME type.
- Path: `private/{ownerType}/{ownerId}/{kind}/{fileId}.{ext}`. The server generates the name.
- EXIF is not parsed. Delivery-proof photos may carry the driver's GPS, so only the customer, the agency and that driver can read them.
- `GET /api/files/[fileId]` runs `canReadFile(viewer, fileDoc)`, then streams the file with `Cache-Control: private, no-store` and `Content-Disposition: inline`.

`canReadFile` rules:

| Kind | Who may read |
|---|---|
| `aadhaar`, `pan`, `driving_license` | The owner, the linked agency (active or pending link), or ops |
| `profile_photo` (driver) | The driver, their agency, and customers with a booking on one of the driver's trips in status `pending_payment` or later |
| `profile_photo` (agency or customer) | The owner and counterparties on shared bookings |
| `vehicle_photo` | Any signed-in user (shown in search results) |
| `delivery_proof` | The booking's customer, agency and driver |

---

## 5. State machines

### 5.1 Booking (`src/lib/domain/booking-machine.ts` v2, pure, D5)

```
                       reject (agency) / respondBy passed (system)
             ┌────────────────────────────────────────────────► rejected
 request     │      accept (agency)          pay ok (system)
 ──────► awaiting_agency ──────► pending_payment ───────────► confirmed ──pickup(OTP)──► picked_up ──► in_transit ──► out_for_delivery ──deliver(OTP+proof)──► delivered
             │                   │  ▲  pay fail                 │                                   (auto on checkpoint   (auto on arrival at
             │                   ▼  │  retry                    │                                    departure ≥ pickup)   drop checkpoint)
             │              payment_failed                      │
             │                   │                              │
             └── cancel ─────────┴── cancel / window expired ───┴── cancel (customer) / refuse pickup (driver) / trip cancelled ──► cancelled
```

| Event | From | To | Actor | Guards | Side effects (same transaction unless noted) |
|---|---|---|---|---|---|
| `request` | (new) | `awaiting_agency` | customer | Shipment owned, `open`, `currentBookingId == null`; trip `published`; trip matches (§7); `now < respondBy`; effective available ≥ weight (advisory) | Create booking, event, `shipment.currentBookingId`, `trip.counts.awaiting++`, notify the agency `booking_requested`, store idempotency |
| `accept` | `awaiting_agency` | `pending_payment` | agency (owner) | Agency `verified`; trip `published`; `now < respondBy`; **effective available ≥ weight** | `trip.holds[id] = {kg, unpaid, dueAt}`; re-lock pricing from current rates; `paymentDueAt = min(now + 120 min, pickup.expectedDepartureAt − 30 min)`; notify the customer `booking_accepted` (includes driver and vehicle) |
| `reject` | `awaiting_agency` | `rejected` | agency | Reason required (≤ 300 chars) | `shipment.currentBookingId = null` (customer can pick another trip); notify `booking_rejected` |
| `expireRequest` | `awaiting_agency` | `rejected` (`no_response_before_departure`) | system | `now ≥ respondBy` | Same as reject; notify `booking_expired` |
| `paymentStarted` | `pending_payment`, `payment_failed` | `pending_payment` | customer (payment create) | Within `paymentDueAt` | `holds[id].dueAt = max(dueAt, now + 15 min)` (checkout grace); payment `created` → `pending` |
| `paymentSucceeded` | `pending_payment`, `payment_failed` | `confirmed` | system (server-confirmed only) | Hold present and (paid, or `dueAt > now`); amount matches | `holds[id] = {kind: "paid"}`; `paidAt`, `paymentId`; create `bookingSecrets` (OTPs); notify customer `payment_succeeded`, agency `payment_succeeded`, driver `shipment_assigned` |
| `paymentFailed` | `pending_payment` | `payment_failed` | system | — | Notify the customer |
| `expirePayment` | `pending_payment`, `payment_failed` | `cancelled` (`payment_window_expired`) | system | `now ≥ holds[id].dueAt` and no payment `pending` younger than the grace period | Delete `holds[id]`; `shipment.currentBookingId = null`; notify customer and agency |
| `cancel` | `awaiting_agency`, `pending_payment`, `payment_failed`, `confirmed` | `cancelled` (`customer_cancelled`) | customer | **Before pickup only** | Delete the hold if present; if paid, payment becomes `refund_pending` and a `refund` job is created; shipment goes back to `open`; notify agency and driver (if confirmed) |
| `tripCancelled` | `awaiting_agency` → `rejected`; `pending_payment`, `payment_failed`, `confirmed` → `cancelled` | as listed | agency (via trip cancel) | No booking on the trip is at `picked_up` or later | Holds removed, refunds queued, notify `trip_cancelled` |
| `refusePickup` | `confirmed` | `cancelled` (`pickup_refused`) | driver | Note required (e.g. prohibited goods) | Full refund job; notify customer and agency |
| `pickup` | `confirmed` | `picked_up` | driver (assigned) | Pickup OTP correct (5 attempts, then customer regenerates); trip `published` or `in_progress`; `now ≥ pickup.expectedDepartureAt − 24 h` | Event; notify the customer `pickup_confirmed` |
| `startTransit` | `picked_up` | `in_transit` | system (auto) or driver | Auto when the driver **departs** checkpoint `i ≥ pickup.checkpointIndex` | Event |
| `outForDelivery` | `in_transit` | `out_for_delivery` | system (auto) or driver | Auto when the driver **arrives** at `drop.checkpointIndex` | Notify the customer |
| `deliver` | `out_for_delivery` | `delivered` | driver | Delivery OTP correct; ≥ 1 proof file (configurable `REQUIRE_DELIVERY_PROOF`, default true) | Create `earnings/{id}` (`pending`); `trip.counts.delivered++`; driver and agency stats; notify customer and agency `delivered`; shipment `completed`; **the hold is kept** (whole-trip capacity, as in Phase 1) |
| `review` | `delivered` (and `reviewed == false`) | — | customer | Rating 1–5, comment ≤ 500 | Create `reviews/{id}`; update rating aggregates on the driver, agency and future trip snapshots; notify `review_received` |

Idempotency rule (kept from Phase 1): applying an event when the booking is already in its target state, reached via that event, returns the booking unchanged with no new side effects.

**Expiry is checked lazily inside every transaction that loads a booking** (`expireIfDue(booking, trip, now)` runs first). It is also run by the sweep (§6.5), so no stale `awaiting_agency` or unpaid hold is ever acted on.

**Customer tabs** (`tab` field, written on every transition):

| Tab | Statuses |
|---|---|
| Pending | `awaiting_agency` (shown as "Awaiting agency"), `pending_payment` ("Accepted — pay by …"), `payment_failed` |
| Confirmed | `confirmed` |
| Picked Up | `picked_up` |
| In Transit | `in_transit`, `out_for_delivery` |
| Delivered | `delivered` |
| Rejected | `rejected` |
| Cancelled | `cancelled` |

Shipments with no booking (`status: open`, `currentBookingId == null`) appear in a "Not booked yet" strip on the customer dashboard and in New Shipment, not in a tab.

**Tracking stages** (`GET /api/customer/bookings/[id]/tracking`):

```
Booking (requested at) → Confirmation (accepted at · paid at) → Pickup (picked_up at, place) → In Transit (at)
  → Checkpoints: one row per trip checkpoint strictly between pickup and drop index,
       with expected arrival time and ACTUAL arrived/departed times from trip events (null = upcoming)
  → Out for Delivery (at) → Delivered (at, proof thumbnails, remarks)
```
- Each stage has `state: "done" | "current" | "upcoming" | "skipped"`.
- `rejected` and `cancelled` end the timeline with a terminal row and its reason.
- `liveLocation` is always `null`. No GPS is collected in v2, and nothing is interpolated or fabricated.

### 5.2 Trip

| Event | From → To | Actor | Guards / effects |
|---|---|---|---|
| create | — → `draft` | agency | Any verification status |
| update | `draft` | agency | Free edit |
| update | `published` | agency | Safe fields only: rates (new requests only), `offeredKg ≥ Σholds` and ≤ vehicle max, goods notes, driver reassignment (no booking at `picked_up` or later, overlap check, booking `driverId` fan-out). Route, times and vehicle changes need `counts.awaiting + counts.held == 0`. |
| publish | `draft` → `published` | agency | Agency `verified`; vehicle `active`; driver link `active` and `available`; departure ≥ now + 60 min and ≤ 60 days out; checkpoint times monotonic; **driver and vehicle schedule free** (§6.4); writes schedule intervals and `pickupKeys` |
| unpublish | `published` → `draft` | agency | No awaiting or held bookings |
| start | `published` → `in_progress` | driver | Departs checkpoint 0 at or after `departureAt − 2 h`; pending requests whose `respondBy` has passed expire |
| checkpoint arrive/depart | `in_progress` | driver | Index order enforced (arrive i, then depart i, then arrive i+1). Fan-out of auto booking transitions (§5.1). Notifies `checkpoint_reached` to customers whose segment covers the checkpoint. |
| complete | `in_progress` → `completed` | driver | Arrived at the last checkpoint; every held booking is `delivered` or `cancelled`. Schedule intervals removed. |
| cancel | `draft`, `published` → `cancelled` | agency | No booking at `picked_up` or later. Cascade (§5.1 `tripCancelled`). Schedule intervals removed. |

Fan-out bound: a trip carries at most ~50 bookings, well under Firestore's 500 writes per transaction.

### 5.3 Payment
`created` → `pending` → `succeeded` | `failed` | `cancelled` (superseded or expired). Then `succeeded` → `refund_pending` → `refunded` | `refund_failed` (retried by the job runner, then raised for ops).

### 5.4 Earnings and settlement
- Delivery creates an `EarningDoc` with status `pending`. `agencyNet = transportationCharge + handlingFee`, and the platform keeps `serviceFee`.
- `npm run ops -- settle --agency <id> --through <date> --reference <UTR>` creates a `SettlementDoc` and marks the earnings `settled` in batched transactions.
- The Earnings page only reads these documents. Nothing is seeded as history except through the same delivery path (§11).
- The Phase 1 `requestPayout` (simulated payouts) is **removed**.

---

## 6. Capacity and concurrency

### 6.1 The ledger
- `trip.holds: Record<BookingId, { kg, kind, dueAt }>` is the **only** capacity ledger.
- The helper `effectiveAvailableKg(trip, now) = offeredKg − Σ kg over holds where kind == "paid" || dueAt > now` is pure and lives in `src/lib/domain/capacity.ts`.
- Expired unpaid holds stop counting **the instant they expire**, even before any sweep writes, so a missed cron can never strand capacity.
- Invariant, checked by `capacityInvariant(trip, bookings)` in tests and `npm run ops -- check-invariants`:
  - `Σ holds.kg (non-expired) ≤ offeredKg ≤ vehicleMaxKg`;
  - each hold's booking is in `pending_payment`, `payment_failed`, `confirmed`, `picked_up`, `in_transit`, `out_for_delivery` or `delivered`;
  - no booking in those statuses lacks a hold.

### 6.2 Transactions (all in `src/server/core/*`, D5)

| Command | Reads (in tx) | Writes |
|---|---|---|
| `requestBooking` | idempotency doc, shipment, trip, customer, 3 candidate booking ids | booking, booking event, shipment, trip.counts, notification, idempotency |
| `acceptBooking` | booking, trip, agency | booking, trip (hold, counts), booking event, notification(s) |
| `rejectBooking` | booking, shipment | booking, shipment, event, notification |
| `cancelBooking` | booking, trip, shipment, payment (if paid) | booking, trip (hold delete), shipment, payment (`refund_pending`), job, events, notifications |
| `confirmPayment` | payment, booking, trip, shipment | payment, booking, trip (hold to paid), bookingSecrets, events, notifications; or a refund job for late or duplicate payments |
| `pickup` / `deliver` | booking, bookingSecrets, trip | booking, secrets (attempts), event, notification, (earning, stats, shipment) |
| `checkpointEvent` | trip, bookings on trip (query `tripId ==, status in [...]`) | trip (checkpoint actual time, progress), trip event, affected bookings, booking events, notifications |
| `publishTrip` | trip, agency, vehicle, driver, `schedules/driver:{id}`, `schedules/vehicle:{id}` | trip, both schedules |

- Firestore server SDK transactions take **pessimistic locks** on the documents they read.
- Two concurrent accepts on the same trip both read `trips/{id}`. One commits and the other is retried, reads the new holds, and fails with `insufficient_capacity` (409) if it no longer fits.
- `MemoryDocStore` reproduces this with optimistic version checks plus retry.
- Domain logic stays pure in a **decider** pattern. For example `decideAccept(booking, trip, agency, now) → { booking, trip, events, notifications } | DomainError` lives in `src/lib/domain/deciders/*`. The transaction loads the documents, calls the decider, and writes the result. Deciders are unit-tested with no store at all.
- Phase 1 `commands.ts` stays until the UI is migrated, then D5 deletes it with the zustand store.

### 6.3 Idempotency
- **Booking request:** the client sends an `Idempotency-Key` header (a UUID generated when the Request button is first armed; it survives double-clicks and retries).
  - `idempotency/{"booking"}:{userId}:{key}` stores `{ requestHash, status: 201, body: { bookingId } }`.
  - A replay with the same hash returns the stored result with HTTP 200.
  - A different body with the same key returns 422 `idempotency_key_reused`.
- **Natural-key guard:** `shipment.currentBookingId` must be null. Even with a different key, a second request for the same shipment returns 409 `shipment_has_open_booking` with `{ bookingId }`. This prevents duplicate bookings across tabs and devices.
- **Payment create:** `Idempotency-Key` is required.
  - At most **one** payment in `created` or `pending` per booking. A second create returns the existing one if it has not expired; otherwise it marks the old one `cancelled` and creates a new one.
  - The payment id doubles as the gateway `order_id`, so Cashfree also dedupes.
- **Payment confirmation:** confirming an already terminal payment is a no-op.
  - If the booking was already paid by another payment, this one is marked `succeeded` and then queued for an automatic refund (`duplicate_payment`).
  - If the booking is cancelled or expired, it is queued for refund (`late_payment`).
- **Webhooks:** `paymentEvents/{sha256(type + order_id + cf_payment_id or refund_id)}` is created in the transaction. If it already exists, the handler returns 200 with no effect.
- **Accept, reject, cancel and driver actions:** idempotent through the state machine rule (same target state means no-op).

### 6.4 Driver and vehicle overlap
- `schedules/driver:{id}` and `schedules/vehicle:{id}` hold `intervals: Array<{ tripId, from: departureAt − 60 min, to: arrivalAt + 60 min }>`. Past intervals are pruned on write.
- `publishTrip`, driver reassignment and time edits read **both** schedule documents in the transaction. That serializes concurrent publishes for the same driver or vehicle, because the lock is on the document read.
- An overlap returns 409 `driver_schedule_conflict` or `vehicle_schedule_conflict` with `{ conflictingTripId }`.
- Cancel and complete remove the interval.

### 6.5 Sweep (`src/server/core/sweep.ts`, D5)
`POST /api/internal/sweep` (`Authorization: Bearer ${CRON_SECRET}`), the `npm run sweep` script, and an opportunistic call in `after()` from the search endpoint (throttled to once a minute per instance) each do the following:
1. Query `bookings where status == "awaiting_agency" && respondBy <= now` and expire each request in its own transaction.
2. Query `bookings where status in ["pending_payment","payment_failed"] && paymentDueAt <= now` and run `expirePayment` (which re-checks the hold's `dueAt` and grace period).
3. Run due `jobs` (refunds, SMS) with exponential backoff (1, 5, 15, 60 min; max 8 attempts, then `failed` and an ops alert log).

Production runs this every 5 min from Vercel Cron or Cloud Scheduler. Correctness does not depend on it (§6.1, §5.1 lazy expiry).

### 6.6 Overbooking and concurrency test plan (D5 writes; runs on memory and emulator)

| # | Scenario | Expectation |
|---|---|---|
| T1 | Trip offers 1000 kg; 15 requests of 100 kg; `Promise.all` 15 accepts | Exactly 10 `pending_payment`, 5 `insufficient_capacity`; invariant holds |
| T2 | Same, mixed with 5 concurrent customer cancels of accepted ones | Final holds = accepted − cancelled; invariant holds; no negative availability |
| T3 | Accept while an unpaid hold has just expired | Expired hold ignored; accept succeeds; sweep later cancels the expired booking without touching the new hold |
| T4 | 10 concurrent `requestBooking` with the same Idempotency-Key | 1 booking; 9 replays return the same id |
| T5 | 2 concurrent requests for the same shipment with different keys | 1 booking; 1 × 409 `shipment_has_open_booking` |
| T6 | Webhook and verify confirm the same payment concurrently | Booking `confirmed` once; 1 `bookingSecrets`; notifications not duplicated |
| T7 | Second payment succeeds for an already confirmed booking | Second payment `refund_pending` (duplicate) and a job created |
| T8 | Payment succeeds after the window expired and the booking was cancelled | `refund_pending` (late); booking stays `cancelled` |
| T9 | Two publishes for the same driver with overlapping times, concurrently | 1 published; 1 × 409 `driver_schedule_conflict` |
| T10 | Seeded random interleaving (200 iterations, fixed seed) of request, accept, reject, cancel, pay, expire | `capacityInvariant` true after every step |
| E2E | Two browser contexts (agency in two tabs) accept the last-fitting requests | One success toast, one capacity error |

---

## 7. Route matching and pricing

### 7.1 Places (`src/lib/domain/places/*`, D5)
- `districts.ts` lists every district of TN (38), KL (14), KA (31), TG (33) and AP (26), about 142 entries. Each entry is `{ id, name, state, hq: { lat, lng }, pincodePrefixes?: string[] }`. Coordinates are approximate district-headquarters values.
- `places.ts` lists hub towns that can be checkpoints: one per district HQ plus extra hubs (Hosur, Pollachi, Kochi, …), each `{ id, name, districtId, lat, lng }`.
- **Matching unit = district.** A shipment address names a district, and a trip checkpoint is a place whose `districtId` is known.
- **Phase 1 `CityId`s map to places:**
  - IDs that are also districts keep the same id: coimbatore, tiruppur, erode, salem, namakkal, krishnagiri, vellore, kanchipuram, chennai, madurai, tiruchirappalli.
  - `hosur` becomes a place in the krishnagiri district.
  - `bengaluru` becomes a place in `bengaluru-urban`.
  - `kochi` becomes a place in `ernakulam`.
  - `cities.ts` remains as a compatibility re-export until the UI is migrated.
- **Distances:** `legKm(a, b)` keeps the curated table and otherwise falls back to haversine × 1.25 (the existing behaviour). The UI labels these as "approx. road km". An agency may override a leg's km within ±30 % when creating a trip; that is stored in `kmFromOrigin`.
- **Pincode check:** the pincode must match `^[1-9]\d{5}$`, and its first two digits must agree with the state (TN 60–64; KL 67–69; KA 56–59; TG 50; AP 51–53). Otherwise the error is `pincode_state_mismatch`.
- **Current location:** `GET /api/geo/nearest-district?lat&lng` returns the nearest district HQ by haversine (no external geocoder), to prefill district and state. The customer still enters the address line and pincode. `Permissions-Policy` must allow `geolocation=(self)` and `camera=(self)` (camera for driver proof); D5 edits `next.config.ts`.

### 7.2 Query strategy
- At publish, compute `pickupKeys = checkpoints[0..n-2].map(c => `${c.districtId}|${istDate(c.expectedDepartureAt ?? departureAt)}`)` (deduped). The destination is excluded because nobody can pick up there.
- The search is **one Firestore query**: `trips where pickupKeys array-contains "${sourceDistrictId}|${shippingDate}" and status == "published" orderBy departureAt limit 200`.
- In-memory filters, in this order:
  1. `pickupIdx` = first checkpoint with `districtId == source`, and `dropIdx` = first checkpoint after `pickupIdx` with `districtId == destination`. If either is missing, the trip is excluded (**order check**).
  2. `now < pickup.expectedDepartureAt − sameDayLeadMinutes`.
  3. `effectiveAvailableKg(trip, now) ≥ weightKg`. Failures are counted in `excludedForCapacity`, as in Phase 1.
  4. Goods: `goodsCategory ∈ trip.goods.accepted`. `specialHandling ⊆ trip.goods.handlingSupported`, but only `temperature_sensitive` must be supported; other handling flags are instructions. `maxPackageKg` is null or ≥ weight.
  5. User filters: `vehicleClass[]`, `maxPrice`, `minCapacityKg`.
  6. The pure `matchTrip(trip, shipment, now)` returns `{ ok: true, offer } | { ok: false, problem }`. It lives in `src/lib/domain/matching.ts` (D3) and is reused by the booking request transaction.
- **Sorts:** `price_asc` (default), `price_desc`, `departure_asc` (pickup expected departure), `arrival_asc` (drop expected arrival), with ties broken by price, then rating, then tripId. Phase 1 badges are kept (`best_price`, `top_rated`, `more_capacity`).
- **Pagination:** results are bounded (trips through one district on one day), so the server returns them all, up to 100 after filters. The client pages locally.

### 7.3 Pricing v2 (`src/lib/domain/pricing.ts`, D5)
- `segmentKm = drop.kmFromOrigin − pickup.kmFromOrigin`.
- `distanceCharge = roundHalfUp(segmentKm × perKmPaise)` and `weightCharge = roundHalfUp(weightKg × perKgPaise)`. These are unchanged from Phase 1.
- `handlingFee = (specialHandling.length > 0 ? trip.rates.handlingFeeRupees : 0)`.
- `serviceFee = serviceFeeFor(weightKg)` (existing slabs).
- `totalPayable` is the sum of the lines. Every line is returned in `lines[]` for the transparent breakdown.
- Limits keep `LIMITS.ratePerKmPaise` and `LIMITS.ratePerKgPaise`, plus `handlingFeeRupees` 0–2000.
- The price is quoted at request and **re-locked at accept** from the trip's current rates. If the price changed, the customer sees it in the accepted notification and on the payment page.
- The payment amount is **always** `booking.pricing.totalPayable × 100` paise, read server-side.

---

## 8. API contract

### 8.1 Conventions
- Base `/api`. JSON in and out (multipart where marked ⓜ). All responses carry `Cache-Control: no-store`.
- **Success** returns the resource itself, or `{ items: T[], nextCursor: string | null }` for lists (`?limit=` default 20, max 50; `?cursor=` opaque).
- **Error** returns `{ error: { code: string, message: string, fields?: Record<string, string> } }`. `message` is user-facing copy, as Phase 1's `DomainError` already provides.

| HTTP | When | Typical codes |
|---|---|---|
| 400 | zod failure, bad JSON | `invalid_request` (+ `fields`) |
| 401 | No or invalid session | `unauthenticated` |
| 403 | Wrong role, not owner, not verified | `forbidden`, `agency_not_verified`, `driver_not_linked` |
| 404 | Not found **or not visible to the caller** (no existence leak) | `not_found` |
| 409 | State conflict | `invalid_transition`, `insufficient_capacity`, `shipment_has_open_booking`, `already_paid`, `driver_schedule_conflict`, `vehicle_schedule_conflict`, `phone_taken`, `registration_taken` |
| 410 | Expired | `otp_expired`, `proof_expired`, `payment_window_closed`, `request_expired` |
| 422 | Domain rule | `not_on_route`, `goods_not_accepted`, `departed`, `otp_invalid`, `too_many_attempts`, `idempotency_key_reused`, `pincode_state_mismatch` |
| 429 | Rate limit | `rate_limited` (+ `Retry-After`) |
| 501/503 | Provider not configured | `payments_not_configured`, `sms_not_configured` |

**Handler wrapper** (`src/server/http/handler.ts`, D5). Every `route.ts` uses it:

```ts
export const POST = handler({
  auth: "agency",                        // "public" | "any" | Role | Role[]
  body: AcceptBookingBody,               // zod schema (or `form: true` for multipart)
  params: z.object({ bookingId: BookingIdSchema }),
  rateLimit: null,
}, async ({ body, params, session, now, req }) => acceptBookingForAgency(session, params.bookingId, now));
```
The wrapper:
- checks Origin for non-GET requests;
- parses the body, query and params (`await ctx.params`, which is a Promise in Next 15+);
- calls `requireSession`;
- maps `DomainError` and `ZodError` to the envelope;
- adds `no-store`;
- injects `now = clock()`, which `TEST_CLOCK` can override in vitest only;
- schedules post-commit work with `after()`.

Route params are typed with Next's global `RouteContext<'/api/...'>`.

### 8.2 Shared zod schemas (`src/lib/api/contracts/common.ts`, D5; isomorphic, used by forms too)

```ts
export const PhoneSchema = z.string().trim().transform((v, ctx) => toE164(v) ?? (ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" }), z.NEVER));
export const PasswordSchema = z.string().min(8).max(64).regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number");
export const OtpCodeSchema = z.string().regex(/^\d{6}$/);
export const ProofTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const IdSchema = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z0-9]{20}$`));
export const BookingIdSchema = z.string().regex(/^TAKI\d{6}$/);
export const StateCodeSchema = z.enum(["TN", "KL", "KA", "TG", "AP"]);
export const DistrictIdSchema = z.string().refine(isDistrictId, "Choose a district from the list");
export const PlaceIdSchema = z.string().refine(isPlaceId, "Choose a place from the list");
export const PincodeSchema = z.string().regex(/^[1-9]\d{5}$/, "Enter a 6-digit pincode");
export const GoodsCategorySchema = z.enum(["general_goods","agriculture","construction","industrial","electronics","furniture","textiles","perishables","other"]);
export const SpecialHandlingSchema = z.enum(["fragile","keep_dry","this_side_up","temperature_sensitive"]);
export const AddressSchema = z.object({
  line1: z.string().trim().min(3).max(120), line2: z.string().trim().max(120).optional(), landmark: z.string().trim().max(80).optional(),
  districtId: DistrictIdSchema, state: StateCodeSchema, pincode: PincodeSchema,
  location: z.object({ lat: z.number().min(6).max(21), lng: z.number().min(68).max(98) }).optional(),
  source: z.enum(["manual", "current_location"]),
}).superRefine(districtMatchesState).superRefine(pincodeMatchesState);
export const IdempotencyKeyHeader = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/);   // header "Idempotency-Key"
export const CursorQuery = z.object({ cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
```

### 8.3 Auth and account (D1) — `src/lib/api/contracts/auth.ts`

```ts
export const OtpSendBody = z.object({ phone: PhoneSchema, role: z.enum(["customer","agency","driver"]), purpose: z.enum(["signup","reset_password"]) });
export const OtpSendForPhoneChangeBody = z.object({ newPhone: PhoneSchema });
export const OtpResendBody = z.object({ challengeId: IdSchema("otp") });
export const OtpVerifyBody = z.object({ challengeId: IdSchema("otp"), code: OtpCodeSchema });
export const CustomerSignupBody = z.object({ proofToken: ProofTokenSchema, fullName: z.string().trim().min(2).max(60),
  dob: z.iso.date(), password: PasswordSchema, confirmPassword: z.string() }).refine(p => p.password === p.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match" });
// ⓜ multipart fields (validated after formData parsing):
export const AgencySignupFields = z.object({ proofToken: ProofTokenSchema, ownerName: z.string().trim().min(2).max(60),
  agencyName: z.string().trim().min(2).max(80), districtId: DistrictIdSchema, vehicleCountRange: z.enum(["1-5","6-10","11-25","26-50","50+"]),
  statesCovered: z.array(StateCodeSchema).min(1), idDocumentKind: z.enum(["aadhaar","pan","driving_license"]), idDocumentNumber: z.string().trim().min(8).max(20),
  password: PasswordSchema, confirmPassword: z.string() });                    // files: idDocument (req), photo (req)
export const DriverSignupFields = z.object({ proofToken: ProofTokenSchema, fullName: z.string().trim().min(2).max(60),
  licenseNumber: z.string().trim().min(10).max(20), licenseValidUntil: z.iso.date().optional(), aadhaarNumber: z.string().regex(/^\d{4}\s?\d{4}\s?\d{4}$/),
  agencyId: IdSchema("agc").optional(), inviteId: IdSchema("inv").optional(), password: PasswordSchema, confirmPassword: z.string() }); // files: licenseFile, aadhaarFile, photo (all req)
export const LoginBody = z.object({ role: z.enum(["customer","agency","driver"]), phone: PhoneSchema, password: z.string().min(1).max(64) });
export const ResetPasswordBody = z.object({ proofToken: ProofTokenSchema, password: PasswordSchema, confirmPassword: z.string() });
export const ChangePasswordBody = z.object({ currentPassword: z.string().min(1), password: PasswordSchema, confirmPassword: z.string() });
export const ChangePhoneBody = z.object({ proofToken: ProofTokenSchema, currentPassword: z.string().min(1) });

export interface OtpChallengeDTO { challengeId: string; expiresAt: IsoDateTime; resendAvailableAt: IsoDateTime; attemptsLeft: number; resendsLeft: number; devOtp?: { code: string; label: "Dev OTP" } }
export interface SessionUserDTO { id: string; role: Role; name: string; phoneMasked: string; photoUrl: string | null;
  agency?: { id: string; name: string; verification: "pending" | "verified" | "rejected"; reason: string | null };
  driver?: { agencyLink: { agencyId: string; agencyName: string; status: "pending" | "active" | "rejected" | "removed" } | null } }
```

| Method | Path | Auth | Body / query | 2xx response | Notable errors |
|---|---|---|---|---|---|
| POST | `/api/auth/otp/send` | public | `OtpSendBody` | 201 `OtpChallengeDTO` | 409 `phone_taken` (signup), 429 |
| POST | `/api/auth/otp/send-phone-change` | any | `OtpSendForPhoneChangeBody` | 201 `OtpChallengeDTO` | 409 `phone_taken` |
| POST | `/api/auth/otp/resend` | public | `OtpResendBody` | 200 `OtpChallengeDTO` | 429 `resend_cooldown`, 422 `too_many_resends`, 410 |
| POST | `/api/auth/otp/verify` | public | `OtpVerifyBody` | 200 `{ proofToken, expiresAt, invite?: { inviteId, agencyName } }` (invite only for driver signup) | 422 `otp_invalid` (+ `attemptsLeft`), 422 `too_many_attempts`, 410 `otp_expired` |
| POST | `/api/auth/signup/customer` | public | `CustomerSignupBody` | 201 `SessionUserDTO` + Set-Cookie | 422 `underage`, 410 `proof_expired`, 409 `phone_taken` |
| POST | `/api/auth/signup/agency` ⓜ | public | `AgencySignupFields` + files | 201 `SessionUserDTO` + cookie | 422 `invalid_document_number`, `file_invalid` |
| POST | `/api/auth/signup/driver` ⓜ | public | `DriverSignupFields` + files | 201 `SessionUserDTO` + cookie | 404 agency not verified / invite invalid |
| POST | `/api/auth/login` | public | `LoginBody` | 200 `SessionUserDTO` + cookie | 401 `invalid_credentials`, 423 `account_locked` (+ `lockedUntil`), 429 |
| POST | `/api/auth/logout` | any | — | 204 + cookie cleared | — |
| GET | `/api/auth/session` | public | — | 200 `{ user: SessionUserDTO \| null }` | — |
| POST | `/api/auth/password/reset` | public | `ResetPasswordBody` | 204 (all sessions revoked) | 410 |
| POST | `/api/me/password` | any | `ChangePasswordBody` | 204 (other sessions revoked) | 401 `invalid_credentials` |
| POST | `/api/me/phone` | any | `ChangePhoneBody` | 200 `SessionUserDTO` (old phone gets an SMS via job) | 409 `phone_taken` |
| GET | `/api/me/profile` | any | — | `CustomerProfileDTO \| AgencyProfileDTO \| DriverProfileDTO` (role-discriminated) | — |
| PATCH | `/api/me/profile` | any | Role-specific: customer `{ fullName }`; agency `{ ownerName, agencyName, districtId, statesCovered, vehicleCountRange }`; driver `{ fullName }` | updated DTO | — |
| PUT | `/api/me/photo` ⓜ | any | file `photo` | `{ photoUrl }` | `file_invalid` |
| GET | `/api/public/agencies` | public | `?q=&districtId=` | `{ items: Array<{ id, agencyName, districtName, state }> }` (verified only, max 20) | — |
| GET | `/api/files/[fileId]` | any | — | File stream | 404 if not readable |
| GET | `/api/geo/nearest-district` | any | `?lat&lng` | `{ districtId, districtName, state }` | 422 outside the 5 states |

### 8.4 Customer (D3) — `src/lib/api/contracts/customer.ts`

```ts
export const CreateShipmentBody = z.object({
  source: AddressSchema, destination: AddressSchema,
  receiver: z.object({ name: z.string().trim().min(2).max(60), phone: PhoneSchema }),
  package: z.object({ weightKg: z.number().int().min(10).max(25_000), goodsCategory: GoodsCategorySchema,
    packageType: z.enum(["box","bag","sack","crate","pallet","loose","other"]), description: z.string().trim().min(3).max(300),
    pieces: z.number().int().min(1).max(500), specialHandling: z.array(SpecialHandlingSchema).max(4).default([]),
    declaredValueRupees: z.number().int().min(0).max(10_000_000).nullable().default(null),
    prohibitedItemsDeclaration: z.literal(true) }),
  shippingDate: z.iso.date(),            // today(IST) .. +60 days
}).refine(s => s.source.districtId !== s.destination.districtId, { path: ["destination","districtId"], message: "Source and destination must be in different districts" });
export const UpdateShipmentBody = CreateShipmentBody;     // only while status "open" && no currentBookingId
export const OffersQuery = z.object({ sort: z.enum(["price_asc","price_desc","departure_asc","arrival_asc"]).default("price_asc"),
  vehicleClass: z.array(z.enum(["Mini Truck","Pickup","Light Truck","Medium Truck","Heavy Truck"])).optional(),
  maxPrice: z.coerce.number().int().positive().optional(), minCapacityKg: z.coerce.number().int().positive().optional(),
  date: z.iso.date().optional() });     // overrides shippingDate for "try another date"
export const RequestBookingBody = z.object({ shipmentId: IdSchema("shp"), tripId: IdSchema("trp") });   // + Idempotency-Key header (required)
export const CancelBookingBody = z.object({ reason: z.string().trim().max(300).optional() });
export const ReviewBody = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() });
export const ShipmentsQuery = CursorQuery.extend({ tab: z.enum(["pending","confirmed","picked_up","in_transit","delivered","rejected","cancelled"]).optional() });

export interface TripOfferDTO {                     // successor of VehicleOffer
  tripId: string; agency: { id: string; name: string; ratingAvg: number; ratingCount: number; verified: true };
  driver: { ratingAvg: number; ratingCount: number; deliveries: number };     // name/photo only after acceptance
  vehicle: { vehicleClass: VehicleClass; makeModel: string; bodyType: BodyType; photoUrl: string | null; imageKey: VehicleImageKey };
  pickup: { checkpointIndex: number; placeName: string; districtName: string; expectedDepartureAt: IsoDateTime };
  drop: { checkpointIndex: number; placeName: string; districtName: string; expectedArrivalAt: IsoDateTime };
  route: Array<{ placeName: string; districtName: string; expectedArrivalAt: IsoDateTime | null; expectedDepartureAt: IsoDateTime | null; inSegment: boolean }>;
  segmentKm: number; availableCapacityKg: number; goods: { accepted: GoodsCategory[]; handlingSupported: SpecialHandling[]; notes: string | null };
  pricing: PricingBreakdownV2; badge?: "best_price" | "top_rated" | "more_capacity";
}
export interface TripDetailsDTO extends TripOfferDTO { reviews: ReviewDTO[]; agencyInfo: { districtName: string; statesCovered: StateCode[]; memberSince: IsoDate; delivered: number }; problem: OfferProblem | null }
export interface CustomerBookingDTO { id: BookingId; status: BookingStatus; tab: CustomerTab; shipment: ShipmentDTO; trip: TripOfferDTO;
  pricing: PricingBreakdownV2; paymentDueAt: IsoDateTime | null; payment: PaymentSummaryDTO | null;
  driver: { name: string; photoUrl: string | null; phone: string | null; ratingAvg: number } | null;      // ≥ pending_payment (phone ≥ confirmed)
  vehicle: { registrationNumber: string } | null; otps: { pickup: string; delivery: string } | null;    // ≥ confirmed, until used
  rejection: {...} | null; cancellation: {...} | null; canCancel: boolean; canPay: boolean; canReview: boolean; review: ReviewDTO | null;
  createdAt: IsoDateTime; updatedAt: IsoDateTime }
export interface TrackingDTO { bookingId: BookingId; status: BookingStatus; stages: TrackingStageDTO[]; events: TrackingEventDTO[]; proofUrls: string[]; liveLocation: null }
export interface CustomerDashboardDTO { counts: Record<CustomerTab, number>; active: CustomerBookingListItem[]; openShipments: ShipmentListItem[]; recentActivity: NotificationDTO[] }
```

| Method | Path | Body / query | 2xx | Errors |
|---|---|---|---|---|
| GET | `/api/customer/dashboard` | — | `CustomerDashboardDTO` | — |
| POST | `/api/customer/shipments` | `CreateShipmentBody` | 201 `ShipmentDTO` | 422 `pincode_state_mismatch`, `past_date`, `date_too_far` |
| GET | `/api/customer/shipments` | `ShipmentsQuery` (no `tab` means open shipments without a booking) | `{ items: ShipmentListItem[], nextCursor }`. Each item is the shipment plus `currentBooking` summary. | — |
| GET | `/api/customer/shipments/[shipmentId]` | — | `ShipmentDTO & { bookings: CustomerBookingListItem[] }` | 404 |
| PATCH | `/api/customer/shipments/[shipmentId]` | `UpdateShipmentBody` | `ShipmentDTO` | 409 `shipment_has_open_booking` |
| DELETE | `/api/customer/shipments/[shipmentId]` | — | 204 (status `withdrawn`) | 409 |
| GET | `/api/customer/shipments/[shipmentId]/offers` | `OffersQuery` | `{ items: TripOfferDTO[], excludedForCapacity: number }` | 404 |
| GET | `/api/customer/trips/[tripId]` | `?shipmentId=` (required for segment and pricing) | `TripDetailsDTO` | 404 |
| POST | `/api/customer/bookings` | `RequestBookingBody` + `Idempotency-Key` | 201 `CustomerBookingDTO` (200 on replay) | 409 `shipment_has_open_booking`, 422 `not_on_route`, `goods_not_accepted`, `departed`, `insufficient_capacity`, 429 |
| GET | `/api/customer/bookings` | `ShipmentsQuery` | `{ items: CustomerBookingListItem[], nextCursor }` | — |
| GET | `/api/customer/bookings/[bookingId]` | — | `CustomerBookingDTO` | 404 |
| POST | `/api/customer/bookings/[bookingId]/cancel` | `CancelBookingBody` | `CustomerBookingDTO` | 409 `invalid_transition` (picked up or later) |
| POST | `/api/customer/bookings/[bookingId]/otp/regenerate` | `{ which: "pickup" \| "delivery" }` | `{ otps }` | 409 (only when attempts are exhausted) |
| GET | `/api/customer/bookings/[bookingId]/tracking` | — | `TrackingDTO` | 404 |
| POST | `/api/customer/bookings/[bookingId]/review` | `ReviewBody` | 201 `ReviewDTO` | 409 `already_reviewed`, 409 not delivered |
| GET | `/api/customer/payments` | `CursorQuery` | `{ items: PaymentHistoryItem[] }` | — |

### 8.5 Agency (D2) — `src/lib/api/contracts/agency.ts`

```ts
export const VehicleBody = z.object({ vehicleClass: VehicleClassSchema, modelId: z.enum([...VEHICLE_MODEL_IDS]).nullable(), makeModel: z.string().trim().min(2).max(60),
  registrationNumber: z.string().trim().transform(normalizeReg).refine(isValidReg), maxPayloadKg: z.number().int().min(100).max(40_000),
  bodyType: z.enum(["open","tarpaulin","closed","container"]), dimensionsFt: z.object({ length: z.number().positive().max(60), width: z.number().positive().max(12), height: z.number().positive().max(15) }).nullable(),
  acceptedGoods: z.array(GoodsCategorySchema).min(1), handlingSupported: z.array(SpecialHandlingSchema).default([]) });
export const DriverInviteBody = z.object({ fullName: z.string().trim().min(2).max(60), phone: PhoneSchema });
export const DriverPatchBody = z.object({ availability: z.enum(["available","unavailable"]) });
export const CheckpointInput = z.object({ placeId: PlaceIdSchema, kmFromOrigin: z.number().int().min(0).max(5000).optional(), // optional override (±30% of computed)
  expectedArrivalAt: z.iso.datetime().nullable(), expectedDepartureAt: z.iso.datetime().nullable() });
export const TripBody = z.object({ vehicleId: IdSchema("veh"), driverId: IdSchema("usr"), offeredKg: z.number().int().min(100),
  checkpoints: z.array(CheckpointInput).min(2).max(10), acceptedGoods: z.array(GoodsCategorySchema).min(1),
  handlingSupported: z.array(SpecialHandlingSchema).default([]), maxPackageKg: z.number().int().positive().nullable().default(null),
  goodsNotes: z.string().trim().max(300).nullable().default(null),
  ratePerKmPaise: z.number().int().min(100).max(10_000), ratePerKgPaise: z.number().int().min(0).max(2_000), handlingFeeRupees: z.number().int().min(0).max(2000).default(0),
  publish: z.boolean() });                  // false = save draft
export const TripPatchBody = TripBody.partial().omit({ publish: true });
export const TripPreviewBody = TripBody.pick({ checkpoints: true, ratePerKmPaise: true, ratePerKgPaise: true }).extend({ sampleWeightKg: z.number().int().default(500) });
export const RejectBookingBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const CancelTripBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const HistoryQuery = CursorQuery.extend({ q: z.string().trim().max(60).optional(), type: z.enum(["bookings","trips","vehicles","drivers","customers"]).default("bookings"), from: z.iso.date().optional(), to: z.iso.date().optional() });
```

| Method | Path | Body / query | 2xx | Errors |
|---|---|---|---|---|
| GET | `/api/agency/dashboard` | — | `{ totals: { vehicles, drivers }, trips: { active, upcoming }, pendingBookings, completedShipments, revenue: { thisMonth, lastMonth, total, monthlySeries }, recentActivity }` | — |
| GET / POST | `/api/agency/vehicles` | `?status=` / `VehicleBody` | list / 201 `VehicleDTO` | 409 `registration_taken` |
| GET / PATCH / DELETE | `/api/agency/vehicles/[vehicleId]` | — / `VehicleBody.partial()` / — | `VehicleDTO` / `VehicleDTO` / 204 (soft `removed`) | 409 `vehicle_has_active_trips` |
| POST / DELETE | `/api/agency/vehicles/[vehicleId]/photos` ⓜ / `…/photos/[fileId]` | file | `VehicleDTO` | ≤ 5 photos |
| GET | `/api/agency/drivers` | `?status=active\|pending\|removed` | `{ items: AgencyDriverDTO[] }` (masked document numbers, `documentUrls`) | — |
| GET | `/api/agency/drivers/[driverId]` | — | `AgencyDriverDTO & { trips: TripListItem[], reviews: ReviewDTO[] }` | 404 |
| PATCH | `/api/agency/drivers/[driverId]` | `DriverPatchBody` | `AgencyDriverDTO` | — |
| POST | `/api/agency/drivers/[driverId]/approve` · `/reject` | — · `{ reason? }` | `AgencyDriverDTO` | 409 not pending |
| DELETE | `/api/agency/drivers/[driverId]` | — | 204 (link `removed`) | 409 `driver_has_active_trips` |
| GET / POST | `/api/agency/driver-invites` | — / `DriverInviteBody` | list / 201 `InviteDTO` (SMS to the driver via job) | 409 already linked |
| DELETE | `/api/agency/driver-invites/[inviteId]` | — | 204 | — |
| POST | `/api/agency/trips/preview` | `TripPreviewBody` | `{ checkpoints: [{ km }], distanceKm, durationMins, earningsPreview }` | 422 |
| GET / POST | `/api/agency/trips` | `?status=&cursor` / `TripBody` | list / 201 `AgencyTripDTO` | 403 `agency_not_verified` (publish), 409 schedule conflicts, 422 time order |
| GET / PATCH | `/api/agency/trips/[tripId]` | — / `TripPatchBody` | `AgencyTripDTO` (includes `bookings[]`, booked vs remaining kg) | 409 `trip_has_bookings` |
| POST | `/api/agency/trips/[tripId]/publish` · `/unpublish` · `/cancel` | — · — · `CancelTripBody` | `AgencyTripDTO` | 403, 409 |
| GET | `/api/agency/bookings` | `?status=&tripId=&cursor` | `{ items: AgencyBookingListItem[] }` | — |
| GET | `/api/agency/bookings/[bookingId]` | — | `AgencyBookingDTO` | 404 |
| POST | `/api/agency/bookings/[bookingId]/accept` | — | `AgencyBookingDTO` | 409 `insufficient_capacity`, `invalid_transition`; 410 `request_expired`; 403 |
| POST | `/api/agency/bookings/[bookingId]/reject` | `RejectBookingBody` | `AgencyBookingDTO` | 409 |
| GET | `/api/agency/history` | `HistoryQuery` | `{ items: HistoryRow[], nextCursor }` | — |
| GET | `/api/agency/earnings` | `?from&to` | `{ summary: { total, pending, settled, thisMonth }, byTrip: [...], byBooking: [...], payments: PaymentHistoryItem[], settlements: SettlementDTO[] }` | — |
| GET / PATCH | `/api/agency/profile` | — / agency fields | `AgencyProfileDTO` | — |
| POST | `/api/agency/verification` ⓜ | new ID document and/or photo | `AgencyProfileDTO` (rejected → pending) | 409 if already verified |

**History search:**
- Bookings carry `searchTokens`: lowercased words of the customer name, receiver name, districts and place names, plus the booking id, vehicle registration and the last 4 digits of the phone.
- The query is `agencyId ==` with `searchTokens array-contains firstToken`, and the remaining tokens are filtered in memory.
- Trips, vehicles and drivers are agency-scoped and small, so they are loaded and filtered in memory.

### 8.6 Driver (D4) — `src/lib/api/contracts/driver.ts`

```ts
export const CheckpointActionBody = z.object({ remarks: z.string().trim().max(300).optional(), clientAt: z.iso.datetime().optional() });
export const PickupBody = z.object({ otp: OtpCodeSchema, remarks: z.string().trim().max(300).optional(), clientAt: z.iso.datetime().optional() });
export const RefusePickupBody = z.object({ reason: z.string().trim().min(5).max(300) });
export const DeliverFields = z.object({ otp: OtpCodeSchema, remarks: z.string().trim().max(300).optional(), clientAt: z.iso.datetime().optional() }); // ⓜ files: proof[] 1..3
export const RemarkBody = z.object({ text: z.string().trim().min(1).max(300) });
export const DriverShipmentsQuery = CursorQuery.extend({ tab: z.enum(["pending_pickup","in_transit","delivered"]).default("pending_pickup") });
```

| Method | Path | Body / query | 2xx | Errors |
|---|---|---|---|---|
| GET | `/api/driver/dashboard` | — | `{ activeTrips, pendingPickups, inTransit, completedDeliveries, nextTrip: DriverTripDTO \| null }` | — |
| GET | `/api/driver/trips` | `?status=upcoming\|active\|completed` | `{ items: DriverTripListItem[] }` | 403 `driver_not_linked` |
| GET | `/api/driver/trips/[tripId]` | — | `DriverTripDTO` (checkpoints with actual times, confirmed+ bookings at each checkpoint) | 404 |
| POST | `/api/driver/trips/[tripId]/checkpoints/[index]/arrive` | `CheckpointActionBody` | `DriverTripDTO` | 409 `checkpoint_out_of_order` |
| POST | `/api/driver/trips/[tripId]/checkpoints/[index]/depart` | `CheckpointActionBody` (index 0 starts the trip) | `DriverTripDTO` | 409, 422 `too_early` |
| POST | `/api/driver/trips/[tripId]/complete` | — | `DriverTripDTO` | 409 `undelivered_shipments` |
| GET | `/api/driver/shipments` | `DriverShipmentsQuery` | `{ items: DriverShipmentListItem[] }` | — |
| GET | `/api/driver/shipments/[bookingId]` | — | `DriverShipmentDTO` (customer and receiver contacts, addresses, package, trip, checkpoints, events) | 404 |
| POST | `/api/driver/shipments/[bookingId]/pickup` | `PickupBody` | `DriverShipmentDTO` | 422 `otp_invalid` (+ `attemptsLeft`), `too_many_attempts`, 409 |
| POST | `/api/driver/shipments/[bookingId]/refuse-pickup` | `RefusePickupBody` | `DriverShipmentDTO` | 409 |
| POST | `/api/driver/shipments/[bookingId]/start-transit` | `CheckpointActionBody` | `DriverShipmentDTO` | 409 (manual fallback) |
| POST | `/api/driver/shipments/[bookingId]/out-for-delivery` | `CheckpointActionBody` | `DriverShipmentDTO` | 409 |
| POST | `/api/driver/shipments/[bookingId]/deliver` ⓜ | `DeliverFields` + `proof` files | `DriverShipmentDTO` | 422 `proof_required`, `otp_invalid` |
| POST | `/api/driver/shipments/[bookingId]/remarks` | `RemarkBody` | 201 `TrackingEventDTO` | — |
| GET | `/api/driver/history` | `CursorQuery & { q? }` | delivered bookings and completed trips | — |
| GET / PATCH | `/api/driver/profile` | — / `{ fullName }` | `DriverProfileDTO` (agency link, stats, reviews) | — |
| POST | `/api/driver/agency-link` | `{ agencyId }` | `DriverProfileDTO` (link `pending`) | 409 already active |

### 8.7 Payments (D5) — `src/lib/api/contracts/payments.ts`

| Method | Path | Auth | Body / query | 2xx | Errors |
|---|---|---|---|---|---|
| POST | `/api/payments/orders` | customer | `{ bookingId }` + `Idempotency-Key` | 201 `{ paymentId, provider: "dev" \| "cashfree", amountRupees, expiresAt, checkout: { kind: "dev", url: "/customer/payment/dev-gateway?paymentId=…" } \| { kind: "cashfree", mode: "sandbox" \| "production", paymentSessionId, orderId } }` | 409 `already_paid`, `invalid_transition`; 410 `payment_window_closed`; 501 `payments_not_configured` |
| GET | `/api/payments/[paymentId]` | customer (owner) | — | `{ status: "pending" \| "succeeded" \| "failed" \| "cancelled" \| "refund_pending" \| "refunded", bookingStatus }`. When pending, this **verifies with the provider** (server-side Get Order) and confirms. | 404 |
| POST | `/api/payments/dev/confirm` | customer (owner) | `{ paymentId, outcome: "success" \| "failure", devToken }` | `{ status, bookingStatus }` | **404 unless `PAYMENT_PROVIDER=dev` and not production**; 403 bad token |
| POST | `/api/payments/cashfree/webhook` | signature | raw body | 200 | 401 `invalid_signature` / `stale_timestamp` |

The existing `cashfree/order` and `cashfree/verify` routes become thin delegates to `/api/payments/orders` and `/api/payments/[id]`, then are deleted once `src/lib/services/payment/cashfree.ts` points to the new paths. The **webhook path stays**, because it is configured in the gateway dashboard.

### 8.8 Notifications, reviews, internal (D5)

| Method | Path | Auth | Body / query | 2xx |
|---|---|---|---|---|
| GET | `/api/notifications` | any | `CursorQuery & { unreadOnly?: boolean }` | `{ items: NotificationDTO[], nextCursor }` |
| GET | `/api/notifications/unread-count` | any | — | `{ count }` (aggregate `count()`; the client polls every 30 s while visible) |
| POST | `/api/notifications/read` | any | `{ ids: string[] (max 50) } \| { all: true }` | 204 |
| GET | `/api/reviews` | any | `?driverId=` or `?agencyId=` + `CursorQuery` | `{ items: ReviewDTO[] }` (customer shown by first name only) |
| POST | `/api/internal/sweep` | `Bearer CRON_SECRET` | — | `{ expiredRequests, expiredPayments, jobsRun }` |
| GET | `/api/health` | public | — | `{ ok, store: "firestore" \| "firestore-emulator", payments: "dev" \| "cashfree", sms: "dev" \| "msg91" }` |

### 8.9 Mapping today's client calls to endpoints (minimal UI churn)

D5 creates `src/lib/api/http.ts`, a `fetch` wrapper. It sends JSON with `credentials: "same-origin"`, sets `Idempotency-Key` when asked, and throws `ApiError extends Error { code, status, fields }`. `errorMessage()` in `marketplace.ts` already reads `.message`, so error toasts keep working.

`marketplace.ts` keeps its **method names**, with bodies replaced by `http` calls. New methods are added per module in `src/lib/api/client/{auth,customer,agency,driver,payments,notifications}.ts`.

| Today (`src/lib/services/**`, `selectors.ts`) | v2 endpoint |
|---|---|
| `marketplace.requestBooking(routeId, shipment)` | `POST /api/customer/shipments`, then `POST /api/customer/bookings { shipmentId, tripId }`. The signature changes to `(shipmentId, tripId)`; the search page already holds both. |
| `marketplace.cancelBooking(id)` | `POST /api/customer/bookings/[id]/cancel` |
| `marketplace.simulateNextUpdate` | **Removed.** Tracking advances only through real driver events. |
| `marketplace.acceptRequest` / `declineRequest` | `POST /api/agency/bookings/[id]/accept` / `reject` (reject now needs a reason) |
| `marketplace.advanceShipment(id, otp)` | Driver: `pickup` / `start-transit` / `out-for-delivery` / `deliver` |
| `marketplace.publishRoute(draft)` | `POST /api/agency/trips { …, publish: true }` (draft: `publish: false`) |
| `marketplace.requestPayout` | **Removed.** Settlements come from ops (`/api/agency/earnings`). |
| `marketplace.updateCustomerProfile` / `updateDriverProfile` | `PATCH /api/me/profile` |
| `marketplace.updateVehicleRegistration` | `PATCH /api/agency/vehicles/[id]` |
| `AuthAdapter.sendOtp` / `resendOtp` / `verifyOtp` | `/api/auth/otp/send` · `resend` · `verify`. `demoCode` becomes `devOtp.code` (label "Dev OTP"). |
| `AuthAdapter.createAccount` | `/api/auth/signup/{role}` |
| `AuthAdapter.resetPassword` / `login` / `logout` | `/api/auth/password/reset` · `/login` · `/logout` |
| `PaymentAdapter.pay` | `POST /api/payments/orders`, then dev gateway page or Cashfree checkout, then poll `GET /api/payments/[id]` |
| `useSession`, `useCurrentCustomer`, `useCurrentDriver` | `GET /api/auth/session`, `GET /api/me/profile` |
| `useOffers`, `useOffer` | `GET /api/customer/shipments/[id]/offers`, `GET /api/customer/trips/[tripId]?shipmentId=` |
| `useBooking`, `useCustomerBookings`, `useCustomerPayments` | `GET /api/customer/bookings/[id]`, `GET /api/customer/bookings?tab=`, `GET /api/customer/payments` |
| `useDriverRequests`, `useDriverRoutes`, `useDriverStats`, `useEarnings`, `useVehicleOptions` | Agency: `/api/agency/bookings`, `/trips`, `/dashboard`, `/earnings`, `/vehicles` |
| `useNotifications` (`markAllRead`) | `/api/notifications`, `/unread-count`, `/read { all: true }` |

Data fetching on the client: plain `fetch` in small hooks (`useApi(key, fn)`) with loading, error and empty states. No new data library is required. If the orchestrator prefers SWR, that is a UI decision outside the backend scope.

---

## 9. Payments

```ts
// src/server/payments/gateway.ts (D5)
export interface PaymentGateway {
  readonly provider: "dev" | "cashfree";
  readonly env: "dev" | "sandbox" | "production";
  createOrder(i: { paymentId: string; amountPaise: number; customer: { id: string; phone: Mobile; name: string };
                   returnUrl: string; notifyUrl: string; expiresAt: IsoDateTime }): Promise<{ checkout: CheckoutPayload }>;
  fetchOrderStatus(paymentId: string): Promise<{ status: "paid" | "failed" | "pending" | "expired"; amountPaise: number | null; providerPaymentId: string | null; methodLabel: string | null; raw: string }>;
  verifyWebhook?(req: { rawBody: string; headers: Headers }): { ok: true; event: GatewayEvent } | { ok: false; reason: "invalid_signature" | "stale_timestamp" };
  refund(i: { paymentId: string; refundId: string; amountPaise: number; reason: string }): Promise<{ status: "pending" | "succeeded" | "failed"; providerRefundId: string | null }>;
  fetchRefundStatus(i: { paymentId: string; refundId: string }): Promise<"pending" | "succeeded" | "failed">;
}
export type GatewayEvent =
  | { type: "payment_succeeded" | "payment_failed" | "payment_dropped"; orderId: string; providerPaymentId: string; amountPaise: number; eventKey: string }
  | { type: "refund_status"; orderId: string; refundId: string; status: "succeeded" | "failed" | "pending"; eventKey: string };
```

- **Selection:** `PAYMENT_PROVIDER=dev|cashfree`. In production, `dev` is refused at boot. `cashfree` without credentials returns 501 `payments_not_configured`, keeping the current behaviour.
- **Order flow (`src/server/payments/service.ts`):**
  1. A transaction validates the booking and creates or reuses the payment (`created`). The amount comes **only** from `booking.pricing.totalPayable`.
  2. `gateway.createOrder` runs **outside** the transaction.
  3. A second transaction stores `checkout` and sets status `pending`.
  4. If the gateway call fails, the payment becomes `failed`, with reason `gateway_error`.
- **Confirmation** goes through a single function, `confirmPayment(paymentId, { source, status, amountPaise, providerPaymentId, methodLabel })`, used by the webhook, verify and the dev gateway (§6.3 semantics):
  - An amount mismatch marks the payment `failed` (`amount_mismatch`) and logs an alert. The booking is never confirmed.
  - **Nothing on the client can mark a payment paid.** Return URLs only trigger `GET /api/payments/[id]`, which asks the provider.
- **Cashfree** (`src/server/payments/cashfree.ts`, reusing `_lib/cashfree-server.ts` helpers):
  - Endpoints: `POST {base}/orders`, `GET {base}/orders/{order_id}`, `POST {base}/orders/{order_id}/refunds`, `GET …/refunds/{refund_id}`.
  - Base URL: `https://sandbox.cashfree.com/pg` or `https://api.cashfree.com/pg`.
  - Headers: `x-client-id`, `x-client-secret`, `x-api-version: ${CASHFREE_API_VERSION}` (default `2025-01-01`).
  - `order_id = paymentId`. `customer_details` carries id, phone and name. `order_meta.return_url = ${APP_ORIGIN}/customer/payment/return?paymentId={order_id}`; `notify_url = ${APP_ORIGIN}/api/payments/cashfree/webhook`. `order_expiry_time = expiresAt`.
  - Webhook: the existing HMAC and timestamp checks are kept. It then parses `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`, `PAYMENT_USER_DROPPED_WEBHOOK` and `REFUND_STATUS_WEBHOOK`.
  - Sandbox webhooks cannot reach `localhost`, so in dev, confirmation happens through the verify path (polling `GET /api/payments/[id]` from the return page).
  - Client checkout uses `@cashfreepayments/cashfree-js` (1.0.7) `load({ mode }).checkout({ paymentSessionId })`. Its CSP additions are D5's job in `next.config.ts`.
  - The stale comments in `verify` and `webhook` (`pending_payment → awaiting_driver`) are replaced. The correct target is `→ confirmed`.
- **Dev gateway (`src/server/payments/dev.ts`):**
  - `createOrder` generates `devToken` (random) and stores its hash. It returns a URL to `/customer/payment/dev-gateway`, a page clearly titled **"Dev payment gateway — no money moves"** with **Approve payment** / **Decline payment** buttons.
  - Those buttons call `POST /api/payments/dev/confirm`. The server checks the token, the ownership and the dev mode, then calls `confirmPayment(source: "dev_confirm")`.
  - With no confirmation, the payment stays `pending` until it expires. It never auto-succeeds.
  - Dev refunds complete immediately but still go through the job runner, so the refund code path is exercised.
- **Refunds:** created as `jobs` (`type: "refund"`, `payload: { paymentId, refundId: "rf_" + paymentId, amountPaise, reason }`) in the cancelling transaction. They run in `after()` and are retried by the sweep. The payment goes `refund_pending` → `refunded`. The customer is notified `payment_refunded`.
- **Method label:** stored masked, from the gateway (`payment_group` and last digits only). TAKI never collects card, UPI or bank data.

---

## 10. Tracking events, delivery proof, notifications

- **Timestamps:** `at` is server time (authoritative, used for ordering). `clientAt` is the device time from the driver app (optional; kept for audit and offline-sync later; never used for ordering). When `clientAt` differs from `at` by more than 10 minutes, the UI may show "recorded at".
- **Checkpoint events** live on `trips/{id}/events` and once in the trip's `checkpoints[i].actual*`. They are not copied into each booking; the customer timeline joins trip checkpoints within the booking's segment. Only **booking-state** changes, driver remarks and proof go to `bookings/{id}/events`.
- **Driver remarks:** `type: "remark"` events, visible to customer and agency.
- **Delivery proof:** the deliver call uploads 1–3 files (`kind: "delivery_proof"`, `ownerType: "booking"`) before the transaction. If the transaction fails (wrong OTP), the uploaded files are deleted. The `delivered` event references `files[]`, and the customer tracking view returns `proofUrls` (`/api/files/...`).
- **Notifications** are created inside the business transaction (`src/server/core/notify.ts`, D5) with role-specific copy. Fan-out is bounded by booking participants.

| Kind | Recipients |
|---|---|
| `booking_requested` | agency |
| `booking_accepted`, `booking_rejected`, `booking_expired` | customer |
| `booking_cancelled` | agency (+ driver if `confirmed`) |
| `payment_succeeded` | customer, agency |
| `payment_failed` | customer |
| `payment_refunded` | customer |
| `shipment_assigned` | driver (on `confirmed`) |
| `pickup_confirmed`, `checkpoint_reached`, `out_for_delivery` | customer |
| `delivered` | customer, agency |
| `review_received` | agency, driver |
| `trip_cancelled` | customers with open bookings, driver |
| `agency_verified`, `agency_rejected` | agency |
| `driver_link_requested` | agency |
| `driver_link_decided` | driver |
| `driver_invited` | (SMS job only; no account yet) |

  SMS is sent for `booking_accepted`, `payment_succeeded` (OTP reminder) and `delivered` only when `SMS_NOTIFICATIONS=true`. It goes through `jobs`, never inline.

---

## 11. Seeding and ops scripts (D5)

`scripts/seed.ts` calls `src/server/seed/index.ts`. Seeding goes **through the same services and deciders** (signup service, vehicle and trip services, `requestBooking`, `acceptBooking`, `confirmPayment(source: "dev_confirm")`, `pickup`, checkpoint events, `deliver`, `review`). Each step receives an explicit `now` (clock injection), so past events have realistic timestamps. **No document is hand-written**, which means the seed also acts as an end-to-end smoke test of the core.

- **Guard:** the seed refuses to run unless `FIRESTORE_EMULATOR_HOST` is set. Running against a real project requires `--allow-remote` **and** `SEED_ALLOW_REMOTE=1` **and** a project id other than the production id in `FIREBASE_PROD_PROJECT_ID`.
- **`--reset`** clears the emulator (`DELETE http://$FIRESTORE_EMULATOR_HOST/emulator/v1/projects/demo-taki/databases/(default)/documents` and the Storage emulator equivalent) first.
- **Dataset**, relative to "now" in IST:
  - 3 agencies (Coimbatore and Chennai verified, Kochi `pending`), each with 2–3 vehicles of varied classes and goods, and 2–3 drivers (one invite-linked, one request-linked, one pending).
  - 12 trips across TN, KL and KA over the next 14 days (2–5 checkpoints each with timings), plus 1 `in_progress` today and 2 `completed` last week.
  - 4 customers, with shipments and bookings in **every** status: awaiting, pending_payment (window open), payment_failed, confirmed, picked_up, in_transit with 1 checkpoint passed, out_for_delivery, delivered with a review and an earning, rejected, and cancelled with a dev refund.
  - Earnings: some `pending`, one agency with a `settled` settlement (reference `SEED-UTR-0001`).
- **Files:** a small bundled `scripts/seed/assets/sample-doc.png` and `sample-photo.png`, stored with `sample: true`. Masked numbers are clearly fake (`XXXX XXXX 0001`).
- **Credentials:** the seed prints a table of role, phone and password. The password comes from `SEED_PASSWORD`, defaulting to the documented dev value `Taki@2025` and never used in production. It is written to `.data/seed-accounts.txt` (gitignored).

`scripts/ops.ts` commands:
- `agency:verify <id>`
- `agency:reject <id> --reason`
- `settle --agency --through --reference`
- `check-invariants`
- `jobs:retry <jobId>`
- `user:disable <userId>`

All of them reuse services and write audit fields.

---

## 12. Module layout and ownership

```
firebase.json  .firebaserc  firestore.rules  firestore.indexes.json  storage.rules      D5
scripts/{seed.ts, ops.ts, sweep.ts, seed/assets/*}                                       D5
src/proxy.ts                                                                             D1
src/lib/domain/                     (pure, isomorphic — shared with the future RN app)
  types.ts, booking-machine.ts, capacity.ts, pricing.ts, constants.ts, places/*, ids.ts   D5
  deciders/{booking,trip,payment}.ts                                                     D5
  matching.ts                                                                            D3
  trip-rules.ts (checkpoint time validation, publish guards)                             D2
src/lib/api/                        (isomorphic contracts + browser client)
  contracts/common.ts, errors.ts, payments.ts, notifications.ts                          D5
  contracts/auth.ts                                                                      D1
  contracts/agency.ts                                                                    D2
  contracts/customer.ts                                                                  D3
  contracts/driver.ts                                                                    D4
  http.ts (fetch wrapper, ApiError)                                                      D5
  client/{auth,agency,customer,driver,payments,notifications}.ts   (each by the module owner; payments/notifications D5)
src/server/                         (every file starts with `import "server-only"`)
  env.ts                    zod-validated server env, lazy                               D5
  clock.ts                  now(); TEST_CLOCK in vitest only                             D5
  firebase/admin.ts                                                                      D5
  db/{docstore.ts, firestore-docstore.ts, schema.ts, collections.ts, index.ts}           D5
  repos/*.ts                one per collection (typed get/query/tx helpers)              D5
  files/{filestore.ts, firebase-storage.ts, uploads.ts, access.ts}                       D5
  http/{handler.ts, errors.ts, origin.ts, rate-limit.ts, idempotency.ts, cursor.ts}      D5
  core/{bookings.ts, trips-lifecycle.ts, capacity.ts, schedules.ts, tracking.ts,
        notify.ts, earnings.ts, reviews.ts, jobs.ts, sweep.ts}                           D5
  payments/{gateway.ts, service.ts, dev.ts, cashfree.ts}                                 D5
  views/{customer.ts, agency.ts, driver.ts, common.ts}   role projections               D3 / D2 / D4 / D5
  auth/{passwords.ts, otp.ts, sessions.ts, session-cookie.ts, guards.ts, sms/*}          D1
  modules/auth/*  modules/profile/*                                                      D1
  modules/agency/{vehicles,drivers,invites,trips,bookings,history,earnings,dashboard,profile}.ts   D2
  modules/customer/{shipments,search,bookings,payments,dashboard}.ts                     D3
  modules/driver/{trips,shipments,history,dashboard,profile}.ts                          D4
  seed/*                                                                                 D5
src/app/api/
  auth/**, me/**, public/**, geo/**, files/** (files handler calls D5 access.ts)         D1
  agency/**                                                                              D2
  customer/**                                                                            D3
  driver/**                                                                              D4
  payments/**, notifications/**, reviews/**, internal/**, health/**                      D5
tests/support/{memory-docstore.ts, memory-filestore.ts, fixtures.ts, http.ts}            D5
tests/unit/server/{auth,agency,customer,driver,core,payments}/**                         each owner
vitest.emulator.config.mts, playwright config changes                                    D5
package.json, next.config.ts (Permissions-Policy, CSP for Cashfree), .env.example, .gitignore   D5
```

**Boundaries:**
- **Cross-role state transitions live only in D5 `core/*`.** D2's accept handler calls `core.bookings.accept(...)`; D4's pickup handler calls `core.bookings.pickup(...)`; D3's cancel handler calls `core.bookings.cancel(...)`. Module owners write validation, read queries, views and role-specific CRUD (vehicles, drivers, trip drafts, shipments, search).
- **Trip publish:** D2 owns `modules/agency/trips.ts` (CRUD, validation, preview). Publish, unpublish, cancel, start, checkpoint and complete call D5 `core/trips-lifecycle.ts`, because they touch schedules, capacity and bookings.
- **Shared files** owned by D5 change only through D5: `schema.ts`, `firestore.indexes.json`, `contracts/common.ts`, `NotificationKind`, error codes, `package.json`. Other agents send D5 a message with the exact addition.
- **Day-0 ordering:** D5 lands, first and within one commit, the stubs of `docstore.ts`, `schema.ts`, `handler.ts`, `contracts/common.ts`, `http.ts`, `tests/support/memory-docstore.ts`, and the `core/bookings.ts` signatures (functions may throw `not_implemented`). Then D1–D4 build against those signatures in parallel. D1 lands `requireSession` and the session types next, because every other handler depends on them.

Core function signatures (D5 publishes on day 0):

```ts
type Ctx = { now: Date; actor: SessionContext };
export const bookings = {
  request(ctx: Ctx, i: { shipmentId: Id; tripId: Id; idempotencyKey: string }): Promise<BookingDoc>,
  accept(ctx: Ctx, bookingId: BookingId): Promise<BookingDoc>,
  reject(ctx: Ctx, bookingId: BookingId, reason: string): Promise<BookingDoc>,
  cancelByCustomer(ctx: Ctx, bookingId: BookingId, note?: string): Promise<BookingDoc>,
  refusePickup(ctx: Ctx, bookingId: BookingId, reason: string): Promise<BookingDoc>,
  pickup(ctx: Ctx, bookingId: BookingId, otp: string, remarks?: string, clientAt?: IsoDateTime): Promise<BookingDoc>,
  startTransit(ctx: Ctx, bookingId: BookingId, remarks?: string): Promise<BookingDoc>,
  outForDelivery(ctx: Ctx, bookingId: BookingId, remarks?: string): Promise<BookingDoc>,
  deliver(ctx: Ctx, bookingId: BookingId, i: { otp: string; proofFileIds: Id[]; remarks?: string; clientAt?: IsoDateTime }): Promise<BookingDoc>,
  addRemark(ctx: Ctx, bookingId: BookingId, text: string): Promise<BookingEventDoc>,
  review(ctx: Ctx, bookingId: BookingId, i: { rating: number; comment?: string }): Promise<ReviewDoc>,
  regenerateOtp(ctx: Ctx, bookingId: BookingId, which: "pickup" | "delivery"): Promise<BookingSecretsDoc>,
};
export const tripsLifecycle = {
  publish(ctx: Ctx, tripId: Id): Promise<TripDoc>, unpublish(ctx: Ctx, tripId: Id): Promise<TripDoc>,
  cancel(ctx: Ctx, tripId: Id, reason: string): Promise<TripDoc>, reassignDriver(ctx: Ctx, tripId: Id, driverId: Id): Promise<TripDoc>,
  checkpoint(ctx: Ctx, tripId: Id, index: number, kind: "arrive" | "depart", i: { remarks?: string; clientAt?: IsoDateTime }): Promise<TripDoc>,
  complete(ctx: Ctx, tripId: Id): Promise<TripDoc>,
};
export const payments = { createOrder, getStatus, devConfirm, handleCashfreeWebhook, confirmPayment };
```

---

## 13. Environment variables and dependencies

### 13.1 Env (server-only unless `NEXT_PUBLIC_`; validated by `src/server/env.ts`)

| Var | Dev (emulator) | Prod | Notes |
|---|---|---|---|
| `FIREBASE_PROJECT_ID` | `demo-taki` | required | |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | — | required (or `GOOGLE_APPLICATION_CREDENTIALS`) | Private key with `\n` escapes |
| `FIREBASE_STORAGE_BUCKET` | `demo-taki.appspot.com` | required | Blaze plan for Storage |
| `FIRESTORE_EMULATOR_HOST` | `127.0.0.1:8080` | **must be unset** | Boot check |
| `FIREBASE_STORAGE_EMULATOR_HOST` | `127.0.0.1:9199` | must be unset | |
| `APP_ORIGIN` | `http://localhost:3000` | `https://…` | Origin check, Cashfree URLs |
| `SESSION_SECRET` | generated if missing (warning) | required, ≥ 32 bytes base64 | HKDF parent for OTP and dev-payment keys |
| `PII_HASH_KEY` | any 32 bytes | required; **never rotate** | Document-number HMAC |
| `SMS_PROVIDER` | `dev` | `msg91` | `dev` refused in production |
| `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER_ID`, `MSG91_NOTIFY_TEMPLATE_ID` | — | required for msg91 | |
| `SMS_NOTIFICATIONS` | `false` | optional | |
| `PAYMENT_PROVIDER` | `dev` (or `cashfree` with sandbox keys) | `cashfree` | |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV` | sandbox optional | required | Existing |
| `CASHFREE_API_VERSION` | `2025-01-01` | same | |
| `CRON_SECRET` | any | required | `/api/internal/sweep` |
| `TRUST_PROXY_HEADERS` | `false` | `true` on Vercel | Rate-limit IP |
| `DEV_AUTO_VERIFY_AGENCIES` | `true` for e2e | ignored | |
| `REQUIRE_DELIVERY_PROOF` | `true` | `true` | |
| `SEED_PASSWORD`, `SEED_ALLOW_REMOTE`, `FIREBASE_PROD_PROJECT_ID` | optional | — | Seed guard |

Remove the `NEXT_PUBLIC_FIREBASE_*` placeholders and `NEXT_PUBLIC_APP_MODE` once the demo store is gone. The client learns modes from API responses (`devOtp`, `checkout.kind`).

### 13.2 Dependencies (versions checked with `npm view` on 2026-11-13)

| Package | Version | Where | Why |
|---|---|---|---|
| `firebase-admin` | `^14.5.1` | dependencies | Firestore + Storage server SDK (engines: node ≥ 22; repo has 24.20) |
| `server-only` | `^0.0.1` | dependencies | Explicit resolution for `tsx --conditions=react-server` scripts |
| `@cashfreepayments/cashfree-js` | `^1.0.7` | dependencies | Hosted checkout (client) when `PAYMENT_PROVIDER=cashfree` |
| `firebase-tools` | `^15.36.0` | devDependencies | Emulators, rules and index deploy (needs Java 21 for emulators) |
| `tsx` | `^4.23.15` | devDependencies | Seed, ops and sweep scripts with `@/` path aliases |

**Not added:**
- `firebase` client SDK: clients never touch Firebase.
- `@firebase/rules-unit-testing`: rules are deny-all, and one emulator test asserting a client SDK denial is not worth the dependency.
- `jose` or `iron-session`: Web Crypto HMAC is enough.
- `argon2`: native build on Windows, and scrypt is sufficient.

Phone and zod helpers already exist.

---

## 14. Test plan summary

| Layer | Runner | Store | Owner | Covers |
|---|---|---|---|---|
| Pure domain (deciders, machine, pricing, matching, capacity, places) | `npm test` | none | D5 / D3 | All transitions, guards, idempotency, price lines, route order, goods, date, capacity math |
| Services + route handlers (call exported `GET`/`POST` with `new Request(...)`, cookies set by a helper) | `npm test` | MemoryDocStore + MemoryFileStore | each owner | AuthN/authZ matrix (every endpoint × 4 callers: anonymous, wrong role, other owner, owner), validation, projections (no PII leak), rate limits, OTP expiry and attempts, password lockout |
| Concurrency suite T1–T10 (§6.6) | `npm test` **and** `npm run test:emulator` | memory **and** emulator | D5 | Overbooking, idempotency, payment races, schedule overlap |
| Payments | both | both | D5 | Dev confirm, Cashfree webhook signature, replay, stale timestamp, amount mismatch, late and duplicate refunds (Cashfree HTTP mocked with `fetch` stubs) |
| E2E (Playwright) | `npm run test:e2e` | emulator + seed | orchestrator / each owner | Three role journeys end to end; two-tab accept race; a11y/responsive assertions ported from v1 |

---

## 15. Risks and open questions for the orchestrator

1. **Java 21:** until it is installed, only `npm test` runs. The dev server refuses to start without the emulator, by design.
2. **District dataset accuracy:** coordinates are approximate, so distances are estimates labelled "approx." and agencies can override leg km by ±30 %. Should the owner want real road distances, a maps API is a later adapter.
3. **Whole-trip capacity** (not per-segment) is conservative and matches Phase 1. Segment-aware capacity is a future change that touches only `capacity.ts` and the `holds` value shape.
4. **No admin UI:** agency verification and settlements are ops scripts. If the owner wants an admin panel, it is a new role and scope.
5. **Route rename** (`/driver/*` → `/agency/*`, new `/driver/*`) needs P3 and orchestrator confirmation.
6. **Booking ids** stay `TAKI######` (900k space). Collisions are retried in the transaction; move to 8 digits before scale.
7. **Storage in production requires the Blaze plan.** The emulator does not.
