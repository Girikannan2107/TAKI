# TAKI Travel — Smart Logistics Marketplace (web)

TAKI Travel connects customers who need to ship goods with lorry drivers who already travel that route with spare space. Customers search for vehicles on their route, compare prices and book only the space they need. Drivers publish routes, set their rates, accept or decline requests and track their earnings.

> **This build runs entirely in demo mode.** Sign-in, OTP, payments, payouts and route maps are demonstration adapters. No SMS is sent, no money moves, and maps are illustrative, not live GPS. Everything is labelled that way in the UI. Demo data lives in your browser's `localStorage` (key `taki-demo-v1`). Client-side route guards are UX only: real authorization must be enforced server-side in production. See [Known limitations](#known-limitations).

## Quick start

Requirements: Node.js 22+ (developed on Node 24), npm 10+.

```bash
npm install
npm run dev          # http://localhost:3000
```

Production build:

```bash
npm run build
npm run start        # http://localhost:3000  (use -- -p 3100 for another port)
```

### Demo accounts

| Role | Mobile | Password |
|---|---|---|
| Customer — Arjun Kumar | +91 98765 43210 | `Taki@2025` |
| Driver — Ravi Kumar (Raj Transport) | +91 98765 43211 | `Taki@2025` |

The login page has **Fill demo customer / Fill demo driver** buttons. You can also sign up with any valid Indian mobile number: the 6-digit OTP is generated randomly and **shown on screen** in a "Demo mode" banner. There is no fixed or bypass code.

Demo data is seeded relative to *today*, so the default search (Coimbatore → Chennai, 500 kg, tomorrow) always returns Raj Transport ₹4,850, Sree Travels ₹5,200 and Kavin Logistics ₹5,450. Data re-seeds the first time the app loads on a new day. Accounts you created are kept; demo bookings are reset. **Profile → Reset demo data** wipes everything.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Vitest unit tests (pricing, state machine, capacity, seed, formatting, redirects) |
| `npm run test:e2e` | Playwright e2e. Build first; the config serves the build on port 3100 (`E2E_PORT` to change). Projects: `desktop` 1440×900, `laptop` 1280×800, `tablet` 768×1024, `mobile` 390×844, `small` 360×800 |
| `npm run check` | typecheck + lint + unit tests |

Example: `npm run build && npx playwright test --project=desktop --workers=1`.

## Stack

Next.js 16.4 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS v4 · lucide-react · react-hook-form + zod 4 · zustand 5 (persisted demo store) · Vitest 5 · Playwright 1.65 + axe-core.

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
  lib/domain/          framework-free business logic (types, pricing, state machine, search, commands)
  lib/data/seed.ts     demo seed (dates relative to now)
  lib/store/           zustand store + read selectors (demo persistence)
  lib/services/        auth / payment / marketplace adapters (demo now, Firebase/Cashfree later)
  lib/format, lib/config, lib/schemas, lib/hooks, lib/utils
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
