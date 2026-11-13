# TAKI v2 — Dev agent brief (read this first on every start/resume)

The agents work in waves, and sessions can end at usage limits. Every agent starts **cold**: re-orient from git and your owned files before writing anything.

## Common
- Repo `D:\urgent`, branch `feat/marketplace`. Windows; Git Bash + PowerShell.
- Read before coding:
  - `AGENTS.md`: Next.js 16.4.6 has breaking changes. Read `node_modules/next/dist/docs/` before writing route handlers, proxy, cookies or pages.
  - `docs/planning/v2/01-plan.md`: binding decisions, the §2 ownership table, the rules.
  - Your spec sections in `p2-backend.md` (backend), `p3-ux.md` (UI) and `00-requirements.md`.
- Re-orient with `git log --oneline -6`, `git show --stat <latest wip commit>`, and by reading your owned files. Earlier sessions' work is committed as `wip(v2)` checkpoints.
- Agent names: `D1-auth`, `D2-agency`, `D3-customer`, `D4-driver`, `D5-backend`. Lead: `team-lead`. Coordinate with SendMessage. If a name is not reachable, tell the lead.
- **Edit only files you own** (01-plan §2). For changes to others' files, message the owner with the exact change. Apply requests for your own files promptly and reply.
- **No `git commit`.** No `next build`, `next dev` or Playwright (they collide in the shared tree). The lead runs those.
- Validate with `npx tsc --noEmit`, `npx eslint <your paths>` and `npx vitest run <your tests>`.
- Java 21 is installed but may not be on PATH in your shell. Use `export PATH="/c/Program Files/Common Files/Oracle/Java/javapath:$PATH"`. Only **D5** runs the Firebase emulator (`npm run test:emulator`), because port conflicts would break parallel runs.
- No static mock data in the UI; data comes from the API. Every screen needs loading/empty/error/success states, must work at 360px, and must be accessible. Preserve TAKI branding and the existing components.
- Every `src/server/**` file starts with `import "server-only"`.
- Contract facts already settled:
  - The canonical `SessionContext` (userId, role, profileId, agencyId, sessionId, name, phone, expiresAt, createdAt) lives in `src/server/core/context.ts`.
  - `requireSession`/`getSession` live in `src/server/auth/guards.ts`.
  - Auth failures throw `DomainError("unauthenticated"|"forbidden")`, which handler.ts maps to 401/403.
  - Cross-role state changes happen only through `@/server/core`.
- When done, SendMessage `team-lead`: `WAVE1 <ID> DONE` + files changed, test results, open issues.

## D5 — Backend core & integration
Implement `core/*` fully. Every booking operation runs in a Firestore transaction, with capacity holds and idempotency:
- bookings: request/accept/reject/cancelByCustomer/refusePickup, pickup (OTP), startTransit, outForDelivery, deliver (OTP + proof files), addRemark, review, regenerateOtp.
- tripsLifecycle: publish (agency must be verified), unpublish, cancel, reassignDriver, checkpoint arrive/depart, complete. Driver/vehicle schedule locks prevent overlaps.
- tracking events + stages, the earnings/settlements read model (read-only; admin/ops mark settled), reviews, the expiry sweep.

Payments:
- Gateway interface.
- The dev gateway requires an explicit server **Approve** step and never auto-succeeds.
- Cashfree sandbox adapter (reuse `src/app/api/payments/cashfree/_lib`), webhook HMAC, refunds outbox.

Endpoints: payments, notifications, reviews, internal/sweep, health, public/contact (stored, rate-limited).

Scripts:
- `scripts/seed.ts`: realistic records through the repositories. Include an admin, verified agencies + vehicles + drivers, published trips with checkpoints, customers, and bookings in varied states. Documented demo credentials.
- `scripts/ops.ts`: verify/reject agency, settle.
- npm scripts.

Config and tests:
- `next.config.ts`: Permissions-Policy `geolocation=(self) camera=(self)`, CSP for Cashfree if needed, and D2's `/driver→/agency` redirects snippet.
- Tests: concurrency T1–T10 (P2 §6.6) on memory **and now on the emulator** (`npm run test:emulator`); unit tests for core and payments.

Legacy `src/lib/store`, `src/lib/services`, `src/lib/data/seed.ts`: remove them only when the lead asks.

## D1 — Auth, accounts, admin, shared UI foundation
Wave 0 foundation is done: tokens, primitives, shell/BottomNav, routes/nav, guards, session cookie.

Wave 1 auth:
- Server OTP: hashed, expiry, attempts, cooldown, rate limits. Dev shows the code labelled "Dev OTP". SMS adapter.
- scrypt passwords. Signed httpOnly cookie plus the Firestore sessions collection (via `getDocStore`).
- `src/proxy.ts` gates /customer, /agency, /driver, /admin. Guests keep the public customer search paths that D3 confirms.

Signup per role (requirements §B; documents + photo uploaded after account creation):
- Customer: DOB 18+.
- Agency: owner, agency, district, vehicle count range, states.
- Driver: agency choice or invite.

Also: one login page with role tabs, logout, recovery. `src/features/account` cards: photo, password, phone change via OTP, masked document list.

Routes: `/api/files/[id]` (calls D5 `serveFile`) and `/api/geo`.

Hidden `/admin`: admin login, pending agencies/drivers, document view, verify/reject with reason, mark settlements settled.

Move `useShellSession` and the auth pages onto the API (`/api/me`, `src/lib/api/client/auth.ts`).

Tests: `tests/unit/server/auth/**`, plus e2e `auth.spec.ts` and `admin.spec.ts` (written, not run).

## D2 — Agency
Move today's `/driver/*` operator UI to `/agency/*`, reusing the inherited feature folders and keeping their look.

Server side: `src/server/modules/agency/*`, `views/agency.ts`, `src/lib/domain/trip-rules.ts`, contracts/client `agency.ts`, `src/app/api/agency/**`.

Pages (`src/app/agency/**`):
- Dashboard: totals, trips, pending bookings, revenue, activity.
- Vehicles CRUD: type, registration, photo, max kg, goods restrictions, specs.
- Drivers CRUD + invite by phone + approve self-registered drivers + assign without overlap.
- Add Trip: vehicle, driver, capacity, accepted/restricted goods, source/destination, multi-checkpoint editor with expected times, departure/arrival, per-kg/per-km, draft or publish. Publish only when verified, via core.
- Trips tabs: upcoming/active/completed/cancelled, booked vs remaining.
- Bookings: accept/reject via core; show the shared customer/receiver details after acceptance.
- History search.
- Earnings: read-only, no withdraw.
- Profile/verification: D1's account cards + uploads.
- Help.

**First:** fix the tsc error at `src/lib/api/client/agency.ts:91` (query value typed `unknown`).

Send D5 the exact `redirects()` snippet. Do not touch `src/app/driver/**`. When `/agency` is complete, message D4-driver `AGENCY ROUTES READY`.

Tests: `tests/unit/server/agency/**`; repoint the e2e driver-journey/driver-routes/driver-requests specs to the agency flow (written, not run).

## D3 — Customer
Move the Phase 1 customer flow (legacy client store) onto the server and extend it to v2, reusing `src/features/{customer-search,booking,payment,payments,shipments,tracking}` and keeping their look.

Server side: `modules/customer/*`, `views/customer.ts`, `src/lib/domain/matching.ts` (reuse D5 `segments.ts`: stop order, date, capacity, goods, vehicle type), contracts/client `customer.ts`, `src/app/api/customer/**`.

Pages:
- Dashboard: stats + recent activity + Ship Goods.
- New Shipment:
  - source: current location → nearest district, or a manual full address with district, pincode, state;
  - destination;
  - receiver name/phone;
  - package: weight, type, description, date, special handling.
- Find Vehicles: filters (type, price, date, capacity) and sorts (price ↑↓, earliest departure, earliest arrival). Guests can search; login is needed to request, and the offer is kept. Tell D1 which customer paths stay public.
- Vehicle Details: driver reviews, agency, route + checkpoints, restrictions, cost breakdown. CTA sticky on mobile.
- Request: idempotency key → awaiting agency.
- Payment: via D5's API inside the payment window. The dev gateway requires Approve.
- My Shipments: 7 tabs (Pending, Confirmed, Picked Up, In Transit, Delivered, Rejected, Cancelled) + a details page with driver, vehicle, receiver, route, booking and a timeline with checkpoints. Real events only; remove "simulate". OTPs are shown to the customer only. Cancel before pickup. Rating after delivery. Keep the receipt.
- Profile: D1's account cards.

**First:** fix the current tsc errors in `src/features/customer-search/{DashboardView,ShipmentForm,VehiclesView}.tsx` (schema migration in progress).

Tests: `tests/unit/server/customer/**`; update the e2e customer specs and `booking-flow.ts` (written, not run).

## D4 — Driver app + landing
The driver app is new and mobile-first.

Server side: `modules/driver/*`, `views/driver.ts` (contact details only for assigned shipments), contracts/client `driver.ts`, `src/app/api/driver/**`.

Pages (`src/app/driver/**`, rewrite):
- Dashboard.
- Assigned Shipments.
- Shipment action screen: pickup with OTP; transit; out for delivery; delivery with OTP + camera proof upload + remarks.
- Trip screen: checkpoint arrive/depart + remarks.
- History.
- Profile: agency, photo, reviews, documents.
- A pending-approval state.

Do not delete the old operator pages under `src/app/driver/**` until D2 sends `AGENCY ROUTES READY`. Agree the collision-free paths with D2 meanwhile.

Landing deltas (p3-ux §5): "drivers"→"agencies"; List a Route → agency signup; Ship Goods = coral CTA to the customer search; contact form → `POST /api/public/contact` (contract agreed with D5); goods category images; footer; responsiveness.

**First:** fix the tsc error in `tests/unit/server/driver/fixtures.ts` (SessionContext now needs `name`).

Tests: `tests/unit/server/driver/**`, e2e `driver-app.spec.ts` (written, not run).
