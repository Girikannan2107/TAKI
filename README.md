# TAKI Travel — Smart Logistics Marketplace (web)

TAKI Travel connects customers who need to ship goods with lorry drivers who already travel that route with spare space. Customers search for vehicles on their route, compare prices and book only the space they need. Drivers publish routes, set their rates, accept or decline requests and track their earnings.

> **v2 runs on a real backend.** All business logic runs in Next.js route handlers backed by Firestore + Firebase Storage (the Firebase Emulator Suite in development and E2E). In development, OTPs are shown on screen labelled "Dev OTP", and payments use a dev gateway that needs an explicit **Approve** (no money moves). Cashfree sandbox is used when it is configured. Tracking shows only real driver events, and maps are illustrative.

## Quick start

Requirements: Node.js 22+ (developed on Node 24), npm 10+, **Java 21** (for the Firebase emulators; on Windows: `export PATH="/c/Program Files/Common Files/Oracle/Java/javapath:$PATH"` in Git Bash).

```bash
npm install
npm run emulators          # terminal 1: Firestore + Storage emulators (data kept in .data/emulators)
npm run seed -- --reset    # terminal 2: clear the emulators and load the demo dataset
npm run dev                # http://localhost:3000 (refuses to start without the emulators)
```

Secrets go in `.env.local` (gitignored): `SESSION_SECRET`, `PII_HASH_KEY`, `CRON_SECRET` (any random 32+ char strings in dev). Non-secret dev defaults are in `.env.development`; see `.env.example` for every variable.

### Demo accounts (created by `npm run seed`)

Password for every seeded account: `Taki@2026` (override with `SEED_PASSWORD`). The full list is printed by the seed and written to `.data/seed-accounts.txt`. **Full guide, with every account and test walkthrough: [docs/DEMO_LOGINS.md](docs/DEMO_LOGINS.md).**

Fixed OTPs for local testing (`DEV_FIXED_OTPS=true` in `.env.development`; refused in production): phone OTP `123456`, pickup code `111111`, delivery code `222222`.

| Role | Mobile | Notes |
|---|---|---|
| Admin (hidden `/admin`) | 90000 00001 | Verify agencies/drivers, record settlements |
| Customer — Priya Raman | 98765 43210 | Confirmed, in-transit, delivered and pending bookings |
| Driver — Ravi Kumar | 98765 43211 | Approved, Kovai Freight Lines; trip in progress today |
| Agency — Kovai Freight Lines | 98765 43220 | Verified; Coimbatore → Chennai trips |
| Agency (pending) — Kochi Coastal Logistics | 90000 00301 | Documents uploaded, awaiting verification |
| Driver (pending) — Senthil Nathan | 90000 00113 | Self-registered, awaiting agency approval |

The dataset is relative to *now*: 17 published trips over the next 14 days, one trip in progress, two completed last week, and bookings in every status. Operator commands: `npm run ops -- <command>` (`agency:verify`, `agency:reject`, `settle`, `check-invariants`, `jobs:retry`, `user:disable`; see `scripts/ops.ts`).

## Scripts

| Command | What it does |
|---|---|
| `npm run emulators` | Firestore + Storage emulators (project `demo-taki`) |
| `npm run seed -- --reset` | Clear the emulators and load the demo dataset |
| `npm run dev` | Next.js dev server (needs the emulators) |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Vitest unit + integration tests (in-memory store, no Java needed) |
| `npm run test:emulator` | Re-runs the core, concurrency (T1–T10), payments and seed suites on the Firestore emulator |
| `npm run test:e2e:build` | `next build` for E2E |
| `npm run test:e2e` | Starts the emulators, resets + seeds them, serves the build with `next start -p 3100` and runs Playwright. Extra Playwright args pass through: `npm run test:e2e -- --project=desktop tests/e2e/auth.spec.ts` |
| `npm run sweep` | Run the expiry sweep once (production: `POST /api/internal/sweep` with `Bearer $CRON_SECRET`) |
| `npm run check` | typecheck + lint + unit tests |

E2E order: `npm run test:e2e:build` (after each code change), then `npm run test:e2e`. Projects: `desktop` 1440×900, `laptop` 1280×800, `tablet` 768×1024, `mobile` 390×844, `small` 360×800. To iterate on one spec without restarting the emulators: keep `npm run emulators` running, set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and `FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199`, and run `npx playwright test <spec>`. The global setup reseeds unless `E2E_SKIP_SEED=1`.

## Stack

Next.js 16.4 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS v4 · lucide-react · react-hook-form + zod 4 · Vitest 5 · Playwright 1.65 + axe-core.

## Pages

| Area | Route |
|---|---|
| Landing | `/` (How it Works, Benefits, About, Contact) |
| Auth | `/signup`, `/auth/login`, `/auth/phone`, `/auth/verify-otp`, `/auth/create-password` |
| Customer | `/customer/dashboard`, `/customer/vehicles`, `/customer/booking/[vehicleId]`*, `/customer/payment`, `/customer/booking-confirmation`, `/customer/tracking/[bookingId]`, `/customer/shipments`, `/customer/payments`, `/customer/profile` |
| Driver | `/driver/dashboard`, `/driver/routes`, `/driver/routes/new`, `/driver/routes/new/pricing`, `/driver/bookings`, `/driver/earnings`, `/driver/profile`, `/driver/help` |
| API (stubs) | `/api/payments/cashfree/{order,verify,webhook}`: return 501 until Cashfree is configured |

\* The `[vehicleId]` segment carries the offer's **route id** (one vehicle runs many routes), e.g. `/customer/booking/rte_r1`.

## Project structure

```
src/
  app/                 routes (server pages export metadata and render client views)
  components/ui|brand|layout   design system, logo, shells, guards (docs/components.md)
  features/<area>/     page views and feature components
  lib/domain/          framework-free business logic (model, pricing, booking machine, capacity, places)
  lib/api/             zod contracts + browser API clients (fetch wrapper)
  server/              route-handler backend: core (all cross-role transitions), modules per role,
                       db (Firestore DocStore), payments, files, auth, seed (npm run seed)
  lib/format, lib/config, lib/schemas, lib/utils
scripts/               seed, ops, sweep, e2e runner
tests/unit, tests/e2e  Vitest and Playwright
public/assets/taki/    brand, hero, vehicle, cargo images
docs/                  planning, QA reports, component and backend docs
```

`src/lib/domain` imports nothing from React, Next.js or the browser, so a future React Native app can reuse it as-is.

## Documentation

- Architecture: [docs/planning/technical-architecture.md](docs/planning/technical-architecture.md) (frozen decisions override it: [implementation-plan.md](docs/planning/implementation-plan.md))
- Routes and buttons: [docs/planning/route-contract.md](docs/planning/route-contract.md)
- Components: [docs/components.md](docs/components.md)
- Data model, pricing and seed: [docs/planning/data-contract.md](docs/planning/data-contract.md)
- Journeys: [customer-flow.md](docs/planning/customer-flow.md), [driver-flow.md](docs/planning/driver-flow.md)
- Backend integration (Firebase, Cashfree): [docs/backend-integration.md](docs/backend-integration.md)
- QA: [visual audit](docs/qa/visual-audit.md), [customer journey](docs/qa/customer-journey.md), [driver journey](docs/qa/driver-journey.md), [responsive & a11y](docs/qa/responsive-a11y.md), [final test report](docs/qa/final-test-report.md)

## Pricing (one formula everywhere)

Rates are stored in paise; displayed amounts are whole rupees, and each line is rounded half-up.
`transport = round(segmentKm × ratePerKm) + round(weightKg × ratePerKg)` (this is the driver's earnings) · `TAKI fee = ₹350 (≤500 kg) / ₹500 (≤1,000) / ₹750 (≤2,000) / ₹1,000` · `total = transport + fee`.
Example: Raj Transport, 498 km × ₹7.50 + 500 kg × ₹1.53 = ₹4,500 + ₹350 = **₹4,850**. Driver preview at ₹12/km and ₹0.50/kg: ₹5,976 + ₹250 = **₹6,226**.

## Environment

Copy `.env.example` to `.env.local`. Nothing is required for demo mode.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_MODE` | `demo` (default) or `live`. In live mode the demo adapters are **not** used, and auth/payments fail closed until real adapters are wired. |
| `NEXT_PUBLIC_FIREBASE_*` | Future Firebase web config (public values only) |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV` | Server-only Cashfree credentials (never `NEXT_PUBLIC_`) |

## Known limitations

| Status | Items |
|---|---|
| **Implemented and tested** | All pages and navigation; validation; pricing; capacity rules (no overbooking, idempotent accept); booking state machine; responsive layouts; demo persistence |
| **Implemented with demo services** | OTP sign-up/login (code shown on screen), password storage (salted SHA-256 in localStorage, demo only), payments ("Demo payment — no money moves"), payouts, tracking status changes (manual driver actions plus a labelled "Demo: simulate next update"), route maps (illustrative SVG, not GPS) |
| **Prepared for integration** | `AuthAdapter` / `PaymentAdapter` interfaces, async marketplace service, Cashfree API routes (501 stubs with signature verification helper), env variables, security headers |
| **Not implemented** | Real SMS/OTP, Firebase Auth/Firestore, real payments/refunds/payouts, live GPS, server-side authorization, driver KYC and vehicle documents, route cancellation with accepted bookings, notifications beyond the in-app list |

The vehicle and hero photographs are synthetic marketing images from the supplied brand kit. They do not represent a verified fleet.
