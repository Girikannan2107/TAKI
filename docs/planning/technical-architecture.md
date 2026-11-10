# Technical Architecture — TAKI Travel website (P2)

Owner: P2 Frontend/System Architect. Status: Phase 1 proposal for the lead sync gate.
Companion docs: `route-contract.md` (every route and button), `component-contract.md` (props and owners).
Domain types, seed data and pricing maths are owned by P3 (`data-model.md`); visual tokens by P1; test plan by P4.
Where P3 names differ from the names used here, P3 wins for `src/lib/domain` and `src/lib/data`.

## 1. Stack (pinned)

| Package | Version | Notes |
|---|---|---|
| next | 16.4.6 | App Router, `src/` dir, Turbopack (default) |
| react / react-dom | 19.3.1 | Scaffold pinned 19.3.0, bump to 19.3.1 |
| typescript | ^5 | `strict: true`; add `noUncheckedIndexedAccess: true` |
| tailwindcss | 4.3.5 | Scaffold used 4.3.3 + `@tailwindcss/turbopack` loader in `next.config.ts`; keep that plugin, align both to 4.3.5 |
| lucide-react | 1.71.0 | Import per icon (`import { Truck } from "lucide-react"`) |
| react-hook-form / @hookform/resolvers / zod | 7.91.0 / 7.0.5 / 4.6.7 | zod v4: `import { z } from "zod"` |
| zustand | 5.1.0 | `persist` + `createJSONStorage(() => localStorage)` |
| vitest | 5.1.0 | Unit tests for pure logic |
| @playwright/test / @axe-core/playwright | 1.65.0 / latest stable | E2E, visual, a11y |

No other runtime deps (no UI kit, no chart lib, no date lib, no map lib). Charts and maps are hand-rolled SVG.
Fonts: `next/font/google` — `Montserrat` (`--font-heading`, weights 500/600/700) and `Inter` (`--font-body`, 400/500/600), `display: "swap"`, set on `<html>`.

## 2. Folder structure

```
src/
  app/
    layout.tsx                 # server: <html lang="en-IN">, fonts, <Providers>, metadata template "%s | TAKI Travel"
    globals.css                # @import "tailwindcss"; @theme { brand tokens from P1 }
    providers.tsx              # client: ToastProvider (+ DemoModeProvider reading NEXT_PUBLIC_APP_MODE)
    not-found.tsx  error.tsx   # error.tsx is "use client"
    (public)/layout.tsx        # SiteHeader + footer
    (public)/page.tsx          # "/"
    (auth)/layout.tsx          # AuthLayout (centred card + WaveDecoration), GuestOnly
    (auth)/signup/page.tsx
    (auth)/auth/{login,phone,verify-otp,create-password}/page.tsx
    customer/layout.tsx        # RequireRole("customer") + DashboardShell(customerNav)
    customer/page.tsx          # redirect("/customer/dashboard")
    customer/{dashboard,vehicles,payment,booking-confirmation,shipments,payments,profile}/page.tsx
    customer/booking/[vehicleId]/page.tsx
    customer/tracking/[bookingId]/page.tsx
    driver/layout.tsx          # RequireRole("driver") + DashboardShell(driverNav)
    driver/page.tsx            # redirect("/driver/dashboard")
    driver/{dashboard,bookings,earnings,profile,help}/page.tsx
    driver/routes/page.tsx  driver/routes/new/page.tsx  driver/routes/new/pricing/page.tsx
    api/payments/cashfree/{order,verify,webhook}/route.ts   # stubs: 501 unless configured
  components/
    ui/        # primitives: Button, IconButton, Input, FormField, Select, Card, Badge, Spinner, Modal, ConfirmDialog, Toast, OtpInput, EmptyState, StatCard, Skeleton
    layout/    # SiteHeader, MobileNavDrawer, DashboardShell, DashboardSidebar, TopBar, PageHeader, AuthLayout, DemoBanner
    brand/     # Logo, WaveDecoration
  features/
    landing/  auth/  customer-search/  booking/  payment/  tracking/
    driver-dashboard/  driver-routes/  driver-requests/  earnings/  profile/  shipments/
  lib/
    domain/        # FRAMEWORK-FREE TS (P3): types, pricing, booking-machine, ids, constants
    data/          # seed data (P3)
    repositories/  # types.ts (interfaces), local/ (demo), firestore/ (future, not built)
    services/      # booking.service.ts, route.service.ts, auth/, payment/ (adapters)
    store/         # zustand slices + persist (client only)
    schemas/       # zod form schemas
    format/        # currency.ts, date.ts, phone.ts, distance.ts
    hooks/         # useHydrated, useSession, useRequireRole, useIdempotentAction
    config/        # env.ts, routes.ts (typed path builders), nav.ts (sidebar items)
    utils/         # cn.ts (class join), safe-redirect.ts
tests/
  unit/            # *.test.ts (Vitest)
  e2e/             # *.spec.ts (Playwright) + fixtures/ (seed-state helper)
public/assets/taki/{branding,hero,vehicles,cargo,ui,elements}/
```

Import rules (enforced by review; optional `eslint-plugin-boundaries` later):
- `lib/domain` imports nothing outside itself (no React, Next, zustand, browser APIs). It must compile in React Native.
- `lib/repositories`, `lib/services` may import `domain`, `data`, `store` (local impl only).
- `components/ui` imports only `lib/utils`, lucide. No store, no features.
- `features/*` may import `components/*`, `lib/*`. Features never import other features except via `features/<x>/index.ts` public exports.
- Path alias `@/*` -> `src/*` (already in scaffold tsconfig).

## 3. Rendering model (Next.js 16 specifics)

- The scaffold has `cacheComponents: true` and `partialPrefetching: true`. Keep them, and follow the pattern below. Under Cache Components, reading `params`, `searchParams`, `cookies()` or `headers()` outside a `<Suspense>` boundary fails the build ("blocking route").
- **Page pattern**: every `page.tsx` is a **server component** that exports `metadata` and renders a client view inside Suspense:
  ```tsx
  export const metadata: Metadata = { title: "Route & Booking Details" };
  export default function Page({ params, searchParams }: PageProps<"/customer/booking/[vehicleId]">) {
    return <Suspense fallback={<BookingDetailsSkeleton />}><BookingDetailsView params={params} searchParams={searchParams} /></Suspense>;
  }
  ```
  The client view (`"use client"`) unwraps with `const { vehicleId } = use(params)`. Do not `await` params in the server page. `PageProps<>` / `LayoutProps<>` are global typed helpers generated by Next 16.
- Client hooks `useSearchParams()` / `useParams()` are allowed only inside a Suspense boundary. Prefer passing the promises down as above.
- Static pages (landing, auth, help) render fully at build. All dashboard data comes from the client store, so dashboard pages prerender a skeleton shell and fill in after hydration.
- `next/image` for every raster asset (local `public/` paths, explicit `width`/`height` or `fill` + `sizes`). Hero image: `priority`, `sizes="100vw"`. Vehicle thumbnails `sizes="(max-width: 768px) 96px, 120px"`.
- `redirect()` from `next/navigation` for `customer/page.tsx` and `driver/page.tsx`.
- Middleware is called `proxy.ts` in Next 16. We **do not** ship one in demo mode (session lives in localStorage, unreadable on the server). See section 6 for production.
- Linting: `npm run lint` = `eslint .` (flat config `eslint.config.mjs`, already scaffolded). `next lint` no longer exists.
- Tailwind v4: no `tailwind.config.*`. Tokens live in `globals.css` under `@theme { --color-brand-900: #173D32; ... --font-heading: ...; }`. P1 defines the token list; D1 implements it.

## 4. State management (zustand)

Single bound store composed from slices, persisted under one versioned key. Client only (`src/lib/store/*` files start with `"use client"`-safe code; never import from server components).

| Slice file | State | Actions (examples) |
|---|---|---|
| `store/session.slice.ts` | `session: Session \| null` (`{ userId, role, name, phone }`), `pendingAuth: { flow: "signup"\|"login"\|"reset", role, phone, otpRequestId, expiresAt } \| null` | `startPendingAuth`, `clearPendingAuth`, `setSession`, `logout` |
| `store/accounts.slice.ts` | `users: Record<id, DemoUser>` (password stored as SHA-256 hex via Web Crypto; demo only) | `upsertUser`, `setPasswordHash` |
| `store/customer.slice.ts` | `search: ShipmentSearch \| null`, `selectedVehicleId`, `bookings: Record<id, Booking>` | `setSearch`, `selectVehicle`, `createDraftBooking`, `updateBookingStatus` |
| `store/driver.slice.ts` | `routes: Record<id, DriverRoute>`, `routeDraft: RouteDraft \| null`, `requests: Record<id, BookingRequest>`, `payouts: Payout[]` | `saveRouteDraft`, `publishRoute`, `acceptRequest`, `declineRequest`, `requestWithdrawal` |
| `store/payment.slice.ts` | `payments: Record<id, PaymentRecord>` keyed by idempotency key | `recordPaymentAttempt`, `markPaid`, `markFailed` |

- `store/index.ts`: `export const useTakiStore = create<TakiState>()(persist((...a) => ({ ...sessionSlice(...a), ... }), { name: "taki-demo-v1", version: 1, storage: createJSONStorage(() => localStorage), partialize, migrate, skipHydration: true }))`.
- `partialize` excludes transient UI state (OTP code shown on screen, in-flight flags).
- `migrate(persisted, version)`: on unknown/older version, return fresh seed state (demo data is disposable). Schema-check with zod on load; corrupt JSON -> reset + console.warn.
- Seed: first load merges P3 seed data (`lib/data`) into empty slices. "Reset demo data" button on Profile pages calls `resetDemo()` (clears key, reseeds).
- Components select narrowly: `useTakiStore(s => s.bookings[id])`; use `useShallow` for multi-field selects.
- Cross-tab: optional `storage` event listener calling `useTakiStore.persist.rehydrate()` (nice-to-have).

**SSR-safe hydration**
- `skipHydration: true`; `<StoreHydrator />` in `providers.tsx` calls `useTakiStore.persist.rehydrate()` in `useEffect` once.
- `useHydrated()` (`lib/hooks/useHydrated.ts`) returns `useTakiStore.persist.hasHydrated()` via `useSyncExternalStore` with `onFinishHydration` subscription; server snapshot `false`.
- Any UI that depends on persisted state renders a `Skeleton` until `useHydrated()` is true. Never branch markup on `typeof window`. Never read `localStorage` during render.
- Guards (`RequireRole`) wait for hydration before redirecting, so reload on a protected page does not bounce to login.
- Dates: format with fixed locale `en-IN` and `timeZone: "Asia/Kolkata"` so server and client strings match.

## 5. Repository / service layer (Firebase-ready)

```
lib/repositories/types.ts
  interface VehicleRepository { search(q: ShipmentSearch): Promise<VehicleOffer[]>; getById(id): Promise<VehicleOffer | null> }
  interface RouteRepository   { listByDriver(driverId); getById(id); create(draft): Promise<DriverRoute>; update(id, patch) }
  interface BookingRepository { listByCustomer(id); listByDriver(id); getById(id); create(input); updateStatus(id, status, event) }
  interface RequestRepository { listByDriver(id); respond(id, "accepted" | "declined") }
  interface UserRepository    { getByPhone(phone); create(user); update(id, patch) }
  interface EarningsRepository{ summary(driverId); settlements(driverId); requestPayout(driverId, amount) }
lib/repositories/local/*      # implement over zustand store + seed, async (Promise) signatures, 150-400ms artificial latency
lib/repositories/index.ts     # getRepositories(): picks local vs firestore by NEXT_PUBLIC_APP_MODE
```

- All signatures are async now so swapping to Firestore needs no call-site changes.
- Services (`booking.service.ts`, `route.service.ts`) hold business rules (price calc via `domain/pricing`, transition checks via `domain/booking-machine`) and are the only callers of repositories from UI. UI -> hook -> service -> repository.
- React Native app later reuses `lib/domain` + `lib/schemas` + repository interfaces verbatim; implementations differ per platform.
- Future Firestore collections (indicative): `users`, `vehicles`, `routes`, `bookings`, `bookings/{id}/events`, `payouts`. Security rules enforce role ownership; status transitions that matter (paid, confirmed) written only by Cloud Functions.

## 6. Auth

```ts
// lib/services/auth/types.ts
export interface AuthAdapter {
  sendOtp(input: { phone: string; purpose: "signup" | "login" | "reset" }): Promise<{ requestId: string; expiresAt: number; demoCode?: string }>;
  verifyOtp(input: { requestId: string; code: string }): Promise<{ verified: true; phone: string } | { verified: false; reason: "invalid" | "expired" | "too_many_attempts" }>;
  setPassword(input: { phone: string; role: Role; password: string; name?: string }): Promise<Session>;
  login(input: { phone: string; password: string }): Promise<Session>;          // throws AuthError("invalid_credentials")
  logout(): Promise<void>;
  getSession(): Promise<Session | null>;
}
```

- `DemoAuthAdapter` (`services/auth/demo-auth.adapter.ts`): generates a random 6-digit code with `crypto.getRandomValues`, returns it as `demoCode`, 30 s resend cooldown, 5 min expiry, max 5 attempts. The code is new and random for every request (resend invalidates the previous one); there is no fixed, master or bypass code, even in demo or tests (e2e reads the on-screen code). The OTP screen shows it in a `DemoBanner` ("Demo mode — no SMS is sent. Your code is 482619") with `data-testid="demo-otp-code"`. Copy must never say "sent to your phone"; reference text "Enter the 6-digit code sent to +91 ..." becomes "Enter the 6-digit code for +91 ..." in demo mode.
- `FirebaseAuthAdapter` (future, `services/auth/firebase-auth.adapter.ts`): `sendOtp` -> `signInWithPhoneNumber(auth, "+91"+phone, RecaptchaVerifier)`; `verifyOtp` -> `confirmationResult.confirm(code)`; password via `linkWithCredential(EmailAuthProvider...)` or a custom-claims profile; role stored as a custom claim set by a Cloud Function. `demoCode` is never returned.
- Adapter chosen in `services/auth/index.ts` by `env.appMode`.
- Phone rules: 10 digits, first digit 6-9, stored as E.164 `+91XXXXXXXXXX`.
- Password rules (reference screen 05): min 8 chars, 1 uppercase, 1 number; live checklist.
- Seeded demo accounts (P3 seed): customer "Arjun" and driver "Ravi" with documented demo passwords shown on the login page's DemoBanner with "Fill demo customer/driver" buttons.

**Guards**
- `RequireRole` (client, `components/layout/RequireRole.tsx`): waits for `useHydrated()`; no session -> `router.replace("/auth/login?next=" + encodeURIComponent(pathname + search))`; wrong role -> `router.replace(dashboardFor(session.role))` + toast "Signed in as a driver — switch account to continue"; renders `<DashboardSkeleton />` meanwhile.
- `GuestOnly` in `(auth)/layout.tsx`: logged-in user hitting `/auth/*` or `/signup` is sent to their dashboard.
- `safeRedirect(next, role)` (`lib/utils/safe-redirect.ts`): accepts only paths starting with `/customer/` or `/driver/` matching the role, rejects `//`, `\`, schemes. Unit-tested.
- **Production**: client guards are UX only. Real authorization must be server-side: Firebase session cookie (httpOnly) verified in `proxy.ts` and in route handlers/server actions; Firestore rules enforce ownership.

## 7. Payments

```ts
// lib/services/payment/types.ts
export interface PaymentAdapter {
  createOrder(input: { bookingId: string; amount: number; currency: "INR"; idempotencyKey: string; customer: { id: string; phone: string } }): Promise<{ orderId: string; providerSessionId?: string }>;
  confirm(input: { orderId: string; method: PaymentMethod }): Promise<void>;     // opens provider checkout / demo simulation
  verify(input: { orderId: string }): Promise<{ status: "paid" | "failed" | "pending"; paidAt?: string; reference?: string }>;
}
```

- `DemoPaymentAdapter`: simulates 1.2 s processing, always `paid` (unless method `"demo_fail"` selected via a hidden test hook `?simulate=fail`), reference `DEMO-xxxxxx`. UI shows "Demo payment — no money moves" in the payment card and on confirmation/receipts. Never shows a bank/UTR number.
- `CashfreePaymentAdapter` (stub, documented, not wired in demo):
  - Client calls `POST /api/payments/cashfree/order` with `{ bookingId, idempotencyKey }` only. Server derives the amount from the stored booking + `domain/pricing` (the request body carries no amount; any amount field is ignored), calls Cashfree Create Order with `x-client-id: CASHFREE_APP_ID`, `x-client-secret: CASHFREE_SECRET_KEY`, env from `CASHFREE_ENV` (`sandbox` | `production`), returns `payment_session_id` only.
  - Client opens Cashfree JS checkout with `payment_session_id`.
  - Booking becomes `confirmed` **only** after server-side verification: `POST /api/payments/cashfree/webhook` (signature verified with the secret, timestamp checked) or `GET /api/payments/cashfree/verify?orderId=` calling Cashfree Get Order. The client redirect alone never marks paid.
  - `verify` and `webhook` are idempotent: they look up the stored payment by `order_id`, and if it is already `paid` they return the existing record and do not transition the booking again. Duplicate or replayed webhooks (same event id) are no-ops. The booking transition `pending_payment -> confirmed` is applied once, guarded by the state machine.
  - Route handlers import secrets via `lib/config/env.server.ts` with `import "server-only"`. When vars are missing they return `501 { error: "payments_not_configured" }`.
- **Idempotency / double submit**: `useIdempotentAction` hook. Key = `pay_${bookingId}_${attempt}` created when the payment page mounts and stored in the payment slice. Pay button disables + shows Spinner while in flight; a second call with the same key returns the existing `PaymentRecord`. Booking already `confirmed` -> payment page redirects to confirmation. Cashfree: same key passed as `order_id` so the provider dedupes too.

## 8. Booking state machine (domain, P3 owns names)

`draft -> pending_payment -> confirmed -> picked_up -> in_transit -> out_for_delivery -> delivered`; side exits `pending_payment -> payment_failed -> pending_payment` (retry), `draft|pending_payment|confirmed -> cancelled`.
Pure function `transition(booking, event): Booking` in `lib/domain/booking-machine.ts`, throws on illegal transition; fully unit-tested. Demo tracking advances by seeded timestamps, not timers; a "Simulate next status" demo button on tracking (labelled demo) is optional.
Driver request: `pending -> accepted | declined`. Accept links to the booking; decline requires ConfirmDialog.

## 9. Forms and validation

- Schemas: `src/lib/schemas/<name>.schema.ts`, export `<name>Schema` and `type <Name>Input = z.infer<typeof <name>Schema>`.
  Files: `phone.schema.ts` (phoneSchema), `otp.schema.ts`, `password.schema.ts` (createPasswordSchema with confirm refine), `login.schema.ts`, `shipment-search.schema.ts`, `route-draft.schema.ts`, `route-pricing.schema.ts`, `profile.schema.ts`, `payment-method.schema.ts`.
- Schemas import limits from `lib/domain/constants.ts` (max weight, min rate) so web and RN share them.
- Forms: `useForm({ resolver: zodResolver(schema), mode: "onTouched" })`. Errors render through `FormField` (`aria-invalid`, `aria-describedby`). Submit buttons show `loading` state and are disabled while submitting.
- Dates in forms are ISO `YYYY-MM-DD` strings (native `<input type="date">`, min = today in Asia/Kolkata); display via `formatDate`.

## 10. Formatting helpers (`lib/format`)

`formatINR(4850) -> "₹4,850"` (`Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })`), `formatDate("2025-11-20") -> "20 Nov, 2025"`, `formatDateTime -> "20 Nov, 09:12 AM"`, `formatPhone("+919876543210") -> "+91 98765 43210"`, `formatKg(2000) -> "2,000 kg"`, `formatKm`.

## 11. Configuration and env

`.env.example` (names only, no values):

```
NEXT_PUBLIC_APP_MODE=demo
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
CASHFREE_APP_ID=
CASHFREE_SECRET_KEY=
CASHFREE_ENV=
```
(`NEXT_PUBLIC_APP_MODE` is the only line with a value, `demo`; the brief lists it that way.)

- `lib/config/env.ts` (client-safe): parses `NEXT_PUBLIC_*` with zod; `appMode` defaults to `"demo"`.
- `lib/config/env.server.ts`: `import "server-only"`; Cashfree vars, all optional; `isCashfreeConfigured`.
- `.env*` already gitignored except `.env.example` (verify `.gitignore` keeps `!.env.example` if a broader pattern is added).
- Security headers in `next.config.ts` `headers()`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. CSP left to P4's recommendation.

## 12. Testing setup

**Vitest** — `vitest.config.ts`:
```ts
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node", coverage: { provider: "v8", include: ["src/lib/**"] } },
});
```
Default env `node` for pure logic; per P4, component tests opt in with `// @vitest-environment jsdom` (+ `jsdom`, `@testing-library/react` dev deps — lead to approve). Node tests cover (pricing, booking-machine, schemas, format, safe-redirect, store reducers via `useTakiStore.getState()` with an in-memory storage).

**Playwright** — `playwright.config.ts`:
```ts
const PORT = 3100;
export default defineConfig({
  testDir: "tests/e2e", fullyParallel: true, retries: process.env.CI ? 2 : 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry", locale: "en-IN", timezoneId: "Asia/Kolkata" },
  webServer: { command: `npm run build && npm run start -- -p ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 240_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "laptop",  use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "tablet",  use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile",  use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "small",   use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
  ],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" } },
});
```
- `tests/e2e/fixtures.ts` (name per P4 test-strategy): `seedState(page, partial)` writes `taki-demo-v1` via `page.addInitScript`; `loginAs(page, "customer" | "driver")`.
- Snapshots in `tests/e2e/__screenshots__/` (committed). Visual tests use a fixed clock (`page.clock.setFixedTime("2025-11-19T10:00:00+05:30")`) so dates match the reference.
- Scripts: `test` (vitest run), `test:watch`, `test:e2e` (playwright test), `test:e2e:update`, `typecheck` (`tsc --noEmit`), `lint` (`eslint .`), `check` (typecheck + lint + test).

## 13. Breakpoints and shell behaviour

- Tailwind default breakpoints. `lg` (1024) is the shell switch: >= lg fixed sidebar 240px; < lg sidebar becomes an off-canvas drawer opened from the TopBar menu button (focus-trapped, Esc closes, returns focus).
- Landing header: >= md inline nav; < md hamburger -> `MobileNavDrawer`.
- Multi-column dashboard grids collapse to one column below `md`. No horizontal scroll at 360px (P4 test).

## 14. Ownership summary (Phase 2)

| Area | Owner |
|---|---|
| `globals.css`, `components/ui`, `components/layout`, `components/brand`, `app/layout.tsx`, `providers.tsx`, `lib/store/index.ts` + `session.slice`, `lib/hooks`, `lib/utils`, `lib/format`, `lib/config` | D1 |
| `app/(public)`, `features/landing` | D2 |
| `app/(auth)`, `features/auth`, `services/auth`, `schemas/{phone,otp,password,login}` | D3 |
| `customer/{dashboard,vehicles,shipments}`, `features/customer-search`, `features/shipments`, `customer.slice` (search) | D4 |
| `customer/booking/[vehicleId]`, `features/booking`, `booking.service` | D5 |
| `customer/{payment,booking-confirmation,tracking,payments}`, `features/{payment,tracking}`, `services/payment`, `payment.slice`, `api/payments/*` | D6 |
| `driver/{dashboard,routes,routes/new}`, `features/{driver-dashboard,driver-routes}`, `driver.slice` (routes), `route.service` | D7 |
| `driver/{routes/new/pricing,bookings,earnings}`, `features/{driver-requests,earnings}`, `driver.slice` (requests/payouts) | D8 |
| `customer/profile`, `driver/{profile,help}`, `features/profile` | D3 (profile) / D7 (help) |
| `lib/domain`, `lib/data`, `lib/repositories` | P3 spec -> implemented first by D1 with P3's files as source (lead to confirm) |

Shared-file rule: slice files have one owner; others request changes via the lead. `store/index.ts` composes slices and is owned by D1.

## 15. Risks / open questions

1. `cacheComponents: true` in the scaffold makes un-suspended `params`/`searchParams` a build error. Mitigation: the page pattern in section 3. Fallback: lead may set `cacheComponents: false` if it blocks progress.
2. `persist` + SSR: forgetting `useHydrated()` causes hydration mismatches. D1 ships `useHydrated` + `Skeleton` first; reviewers grep for direct store reads in markup without the guard.
3. Reference copy implies real SMS ("sent to +91 ...") and live tracking ("View Live Route") — both must be reworded in demo mode (P1/P4 copy).
4. Phase 2 parallelism: D1 primitives and the store are dependencies for everyone. Recommend D1 lands `components/ui` stubs with final prop types on day 1 so others can code against them.
5. Money unit (rupees vs paise) and enum names are owned by P3 and must be frozen at the sync gate.
