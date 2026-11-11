# Backend integration notes (Firebase + Cashfree)

The web app is built so the demo adapters can be swapped for real services without touching page code. This document lists the seams and what each production integration must guarantee.

## 1. Seams in the code

| Concern | Interface / module | Demo implementation | Production replacement |
|---|---|---|---|
| Authentication | `src/lib/services/auth/types.ts` → `AuthAdapter` | `demo-auth.ts`: random OTP shown on screen, salted SHA-256 passwords in localStorage | `FirebaseAuthAdapter`: `signInWithPhoneNumber` + `RecaptchaVerifier`, `confirmationResult.confirm(code)`; never returns `demoCode` |
| Payments | `src/lib/services/payment/types.ts` → `PaymentAdapter` | `demo-payment.ts`: simulated success/failure, no gateway | `cashfree.ts` (already wired to call `/api/payments/cashfree/order`) |
| Marketplace data | `src/lib/services/marketplace.ts` (async) + `src/lib/domain/commands.ts` (pure rules) | zustand store (`src/lib/store`) + localStorage | Firestore reads + Cloud Functions that run the same `commands.ts` rules server-side |
| Reads | `src/lib/store/selectors.ts` hooks | derive from the local store | subscribe to Firestore queries; keep the hook signatures |
| Mode switch | `src/lib/config/env.ts` (`NEXT_PUBLIC_APP_MODE`) | `demo` | `live`; live auth/payment fail closed until configured |

`src/lib/domain/**` is framework-free and should be shared with the React Native app (a workspace package is the natural next step).

## 2. Firebase (shared web + mobile backend)

- **Auth:** phone auth with reCAPTCHA (web) / Play Integrity + APNs (mobile). Store `role` as a custom claim set by a Cloud Function after signup. Passwords are optional; if kept, link an email/password credential or drop them for OTP-only login.
- **Session on the web:** exchange the ID token for an httpOnly session cookie (route handler). Verify it in `proxy.ts` (Next 16 middleware) for `/customer/*` and `/driver/*`, and in every route handler. The client `RequireRole` guard remains UX only.
- **Firestore collections (indicative):** `users`, `customers`, `drivers`, `vehicles`, `routes`, `bookings` (+ `bookings/{id}/events`), `payments`, `earnings`, `payouts`, `notifications`.
- **Security rules:** customers read/write only their own bookings and payments; drivers read their routes and the bookings on them. Status transitions that matter (`paid`, `confirmed`, capacity changes, `delivered` → earnings) are written **only** by Cloud Functions running `commands.ts` inside a transaction. That keeps capacity and idempotency guarantees server-side.
- **Scheduled function:** `expireDepartedRequests` (already in `commands.ts`) on a schedule, so unanswered requests are declined and refunded when a route departs.

## 3. Cashfree payments

Route handlers live in `src/app/api/payments/cashfree/{order,verify,webhook}/route.ts`. Helpers are in `_lib/cashfree-server.ts` (server-only). Until `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` and `CASHFREE_ENV` are set, they return **501 `payments_not_configured`**.

Required production flow:
1. **Create order:** the client sends only `{ bookingId, idempotencyKey }`. The server loads the booking, checks ownership and status `pending_payment`, **derives the amount from the stored pricing snapshot** (any client amount is ignored) and calls Cashfree *Create Order* with `order_id = idempotencyKey`. It returns only `payment_session_id`.
2. **Checkout:** the client opens Cashfree Checkout (JS SDK) with that session id.
3. **Confirm:** only a server-side confirmation marks a booking paid: the signed **webhook** (HMAC-SHA256 of timestamp + raw body with the secret, compared with `timingSafeEqual`, stale timestamps rejected) and/or **verify** (Cashfree *Get Order*). Both are idempotent by `order_id`: a replayed event returns the stored record and never transitions the booking twice.
4. **Refunds:** driver decline, customer cancel and route-departed expiry must call Cashfree *Create Refund* from a Cloud Function. The demo only marks the payment `refunded`.
5. **Payouts:** driver withdrawals need Cashfree Payouts (or bank transfer) with KYC. The demo `requestPayout` only records a simulated payout.

Never expose `CASHFREE_SECRET_KEY` to the client (no `NEXT_PUBLIC_` prefix). Never collect card/UPI/bank details in our own forms. Use the gateway's hosted checkout.

## 4. Tracking and maps

The route map (`src/features/booking/RouteMap.tsx`) is an illustrative SVG built from city coordinates. Live tracking would need driver-app location sharing with consent, a map provider (Google Maps / Mapbox / MapmyIndia) and server-validated status events. Until then the UI must keep the "Illustrative route — not live location" label.

## 5. Production readiness checklist

- [ ] Replace demo adapters (auth, payment, marketplace) and remove demo seed and credentials from live builds
- [ ] Server-side authorization (session cookie + proxy + Firestore rules)
- [ ] Cashfree order/verify/webhook/refund implemented and tested in sandbox
- [ ] Content-Security-Policy with script/style sources for the chosen SDKs (current CSP covers framing/base/form/object only)
- [ ] Rate limiting on OTP and login, abuse monitoring
- [ ] Driver KYC and vehicle document verification before routes are bookable
- [ ] Privacy policy, terms, data retention, and DPDP Act compliance review
