# TAKI v3 — Target architecture

**Status: approved by the owner** (with the dev-only payment gateway kept; Firestore `asia-south1`; full refund before pickup).

Consolidates the three planning documents. Detail lives in:

| Doc | Content |
|---|---|
| [P1-audit.md](P1-audit.md) | What exists today: 120 API handlers, business rules, tests, risks, move map |
| [P2-architecture.md](P2-architecture.md) | FastAPI layout, auth, Firestore model, state machines, capacity, matching, Cashfree, security, ownership (§18) |
| [P2-api-contract.md](P2-api-contract.md) | 129 endpoints (E1–E129) under `/api/v1`; Appendix A maps every current route |
| [P3-workflow-ui-deploy.md](P3-workflow-ui-deploy.md) | End-to-end workflow, screen inventory, frontend changes, monorepo tooling, deployment, test plan, work order |

Where the planning docs disagreed, the resolution is recorded in §2.

## 1. Owner decisions already made

- Branch `feat/fastapi-monorepo` (from `feat/marketplace`).
- Signup and password reset: Firebase phone OTP (reCAPTCHA). Daily login: phone + password.
- Frontend on Firebase App Hosting; FastAPI on Cloud Run (Docker).
- Database starts empty (no seed). Tests create their own fixtures.

## 2. Resolved design choices

| Topic | Decision | Why |
|---|---|---|
| Password login | FastAPI verifies phone + password (argon2id hash in `credentials/{uid}`, lockout + rate limits), then mints a Firebase **custom token**; the browser calls `signInWithCustomToken`. Firebase email/password provider stays **off**. | With a synthetic-email Firebase account, anyone could call Google's sign-in API with the public key and bypass our lockout. |
| OTP token scope | Phone OTP runs in a separate Firebase app instance and yields a short-lived *phone-proof* token, accepted only by signup, password reset and phone change. | OTP alone never grants day-to-day access. |
| Authorisation | Every call sends `Authorization: Bearer <Firebase ID token>`; FastAPI verifies it and loads `users/{uid}` (source of truth for role, status, revocation). Custom claims `{role, agencyId}` are only for frontend routing. | Roles enforced server-side. |
| API base | FastAPI serves `/api/v1/*`. Production: browser calls `NEXT_PUBLIC_API_BASE_URL` (Cloud Run custom domain) directly, CORS restricted to the web origin. Dev/e2e: Next `rewrites()` proxies `/api/v1` → `localhost:8000`. | Bearer tokens make cross-origin safe (no cookies → no CSRF); no proxy hop in production. |
| Contracts | Keep today's JSON field names and DTO shapes and the `{"error":{code,message,fields}}` envelope with the same codes. | Frontend migration is mostly transport + auth. |
| Booking state | Four independent fields: `approvalStatus`, `paymentStatus`, `reservationStatus`, `fulfilmentStatus` (+ closure record). Today's `status`/`tab` are derived by one pure function and stored for queries. | Approval, payment and reservation kept separate, as required. |
| Capacity | Held at agency **acceptance**, per route leg (space frees after the drop stop). All transitions in Firestore transactions; driver/vehicle schedule locks block overlapping assignments. | No overbooking; no long holds on unanswered requests. |
| Matching | Pickup stops publish geohash cells keyed by date → one indexed query, then exact checks: service radius, pickup-before-drop order, time, goods, segment capacity. Road distance from Google Routes (cached). Never pincodes. | Exact + intermediate-stop matching. |
| Maps | Trip route (legs, durations, polyline) computed once with Google Routes and cached on the trip. Browser key: Maps JS + Places, referrer-restricted. Server key: Geocoding + Routes, Secret Manager. `liveLocation` always null. | No fabricated GPS. |
| Payments | Cashfree only. Order + session server-side; checkout via Cashfree JS; one confirmation path (webhook signature check → dedupe → re-verify with Cashfree API). Late/duplicate payments auto-refunded. Without credentials: `501 payments_not_configured`. **Dev gateway kept for local/e2e only** (owner decision): enabled only when `PAYMENT_PROVIDER=dev` AND `APP_ENV` is `development` or `test`; the app refuses to start with it in production, and the UI labels it "Test payment". | Never simulated success in production. |
| Files | Firestore + Storage rules deny all client access (Storage keeps an owner/admin read backstop). Files served through 60-minute HMAC-signed `/api/v1/files/{id}/content` URLs. Aadhaar/licence/RC/PAN numbers masked in every DTO. | Private documents. |
| Admin bootstrap | `scripts/bootstrap_admin.py` creates the first admin (empty database has no other path). | Agencies need verification to publish. |
| Shared data | Districts, checkpoint places, vehicle models, enums, pricing constants become JSON in `backend/app/data/`; TypeScript types generated for `apps/web`. | One source of truth. |

## 3. Folder structure

```
apps/web/                 Next.js 16 app (moved from repo root): src/app, features, components, lib, tests (vitest + Playwright), own package.json
backend/
  app/                    main.py, core/, api/v1/, schemas/, models/, repositories/, services/, middleware/, integrations/, data/, deps.py
  tests/                  pytest (unit + emulator integration)
  Dockerfile, pyproject.toml, requirements.txt, requirements-dev.txt, .env.example
firebase/                 firebase.json (+ Auth emulator), .firebaserc, firestore.rules, firestore.indexes.json, storage.rules
scripts/                  dev.mjs (emulators + uvicorn + next), bootstrap_admin.py, gen-types
docs/                     v3 docs, setup + deployment guides
.github/workflows/        ci.yml, deploy-backend.yml, deploy-firebase.yml
.gitattributes            line-ending normalisation (own commit, before the move)
```

Deleted after the Python port passes end to end: `src/server/`, all `src/app/api/` handlers, `src/proxy.ts`, the TypeScript dev payment gateway (re-implemented in FastAPI, dev/test only), Dev OTP UI, legacy `/driver/routes…` redirects, v1 leftovers (`cities.ts`, `types.ts`, unused schemas, unused `@cashfreepayments/cashfree-js`).

## 4. New or changed screens

Changed: auth pages → Firebase OTP + reCAPTCHA; address/checkpoint inputs → Places Autocomplete; SVG route map → Google map (SVG kept as fallback); payment page → Cashfree checkout (dev-only test gateway kept for local/e2e).
New: additional charges on trip pricing (price breakdowns list `pricing.lines`); Terms / Privacy / Refund / Shipping pages (Cashfree activation needs them); agency reviews card; admin payments and booking detail; "verified phone but no password yet" resume step.

## 5. Execution plan

1. **Foundations (sequential):** `.gitattributes` commit → D1 moves the app to `apps/web` alone (no other edits) → D5 creates `firebase/` + CI skeleton, D2 the FastAPI skeleton (config, errors, auth deps, health).
2. **Auth:** D2 (FastAPI auth, users, profile, admin) + D1 (Firebase JS, token attachment, auth pages).
3. **Domains in parallel:** D3 (Firestore layer, agency, vehicles, drivers, trips), D4 (shipments, matching, bookings, tracking, notifications, reviews), D5 (Cashfree, Maps, Docker, Cloud Run, CI), D1 (screen changes per §4). Backend file ownership per P2 §18; frontend per P3.
4. **Testing:** T1 (responsive UI, navigation, visual), T2 (API + DB + full three-role workflow), T3 (security, payments, concurrency, deployment). Bugs go back to the owning developer with reproduction steps; testers retest.
5. **Cut-over:** delete the TypeScript backend only when pytest + Playwright pass against FastAPI.

Python: 3.12 via `py -3.12` (machine default is 3.14). Deployment needs `gcloud` (not installed here) or the GitHub Actions workflows; live deploy requires the owner's GCP/Firebase project and credentials.

## 6. Defaults applied unless the owner says otherwise

| # | Question | Default |
|---|---|---|
| 1 | Firestore region (permanent) | `asia-south1` (Mumbai); App Hosting + Cloud Run same region — **owner confirmed** |
| 2 | When is capacity held? | At agency acceptance |
| 3 | Cancellation before pickup | 100 % refund incl. TAKI fee — **owner confirmed** |
| 4 | Vehicle RC verification | Upload required, admin review optional |
| 5 | Driver verification | Admin-verified before trip assignment |
| 6 | Pickup radius per stop | 10 km default, 15 km max |
| 7 | Delivery proof | OTP mandatory, photo optional |
| 8 | Service area | TN, KL, KA, TG, AP |
| 9 | Logout | "Log out" = this device; "Log out everywhere" revokes all |
| 10 | SMS for booking updates | None (in-app notifications only); receiver delivery code shown to customer to share |
| 11 | GST | Not itemised in v3; flagged for a later decision |
| 12 | Firebase test phone numbers | Staging/emulator only, never production |
| 13 | Admin login | Phone + password, same as other roles (2-step later) |
| 14 | Legal page text | Placeholder structure; owner supplies final text |
| 15 | Environments | Separate staging Firebase project assumed |
| 16 | Maps caching | place ids indefinitely, coordinates/polylines 30 days |
