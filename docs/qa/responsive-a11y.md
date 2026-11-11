# Responsive & Accessibility Report (T4 scope)

**Spec:** `tests/e2e/responsive-a11y.spec.ts`, written by T4.
**Execution and repairs:** T4 wrote the spec, then hit the usage limit before it could run the suite or write this report. The Lead ran the suite and acted as repair owner for the findings (implementation-plan §3 allows a designated repair owner). The Lead also corrected three detector false positives in the spec, which are listed below.
**Target:** WCAG 2.2 AA, checked with `@axe-core/playwright` (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) plus custom checks.
**Server:** production build (`next start`, port 3100). All results below are from the final build of 2026-11-11.

## Coverage

| Group | Pages |
|---|---|
| Public | `/`, `/signup`, `/auth/login`, `/auth/phone`, 404 |
| Auth flow | `/auth/verify-otp`, `/auth/create-password` (reached through the real OTP flow) |
| Customer | dashboard, vehicles, booking/rte_r1, payment, booking-confirmation, tracking/TAKI874523, shipments, payments, profile |
| Driver | dashboard, routes, routes/new, routes/new/pricing, bookings, earnings, profile, help |

The suite checks the following on every page and viewport:
- Horizontal overflow: `scrollWidth ≤ innerWidth`, plus a list of the elements that overflow.
- One visible h1, plus landmarks, `lang`, title, image alt text and exposed SVGs.
- Tap targets of at least 24×24 px (WCAG 2.5.8), with inline-text links and stretched-link cards exempt.
- An axe scan, where any serious or critical violation fails the test.

Additional checks:
- The dashboard drawer and the landing hamburger below 1024 px: focus trap, Esc to close, focus returning to the trigger, `aria-modal`, and axe with the drawer open.
- Keyboard: skip link, visible focus and order on forms, the OTP input (labels, auto-advance, backspace, paste), focus handling in modals (View Route, Withdraw, Decline), and error states (`aria-invalid`, `aria-describedby`, `role=alert`).
- Reduced motion: `prefers-reduced-motion`.

## Final results (actual runs)

| Project | Viewport | Passed | Skipped (by design) | Failed |
|---|---|---|---|---|
| mobile | 390×844 | 10 | 1 (OTP test runs at desktop + 360 only) | 0 |
| desktop + small | 1440×900, 360×800 | 16 | 6 (drawers at ≥1024; keyboard subsets per viewport) | 0 |
| laptop + tablet | 1280×800, 768×1024 | 9 | 13 (keyboard subsets run on desktop/mobile only) | 0 |

Command: `E2E_PORT=3100 npx playwright test tests/e2e/responsive-a11y.spec.ts --project=<p> --workers=1`

- No page has horizontal overflow at any of the five viewports.
- Axe reports zero serious or critical violations on every page, including with the drawer open and in form error states.

## Defects found and fixed

| ID | Sev | Finding | Root cause | Fix | Status |
|---|---|---|---|---|---|
| A-01 | P2 | `label-content-name-mismatch` (WCAG 2.5.3) on every page, in the header, sidebar and drawers | The Logo link had `aria-label="TAKI Travel home"`, and its stacked wordmark spans produced the visible text "TAKITRAVEL" | `Logo.tsx`: the name now comes from the visible wordmark, with a hidden space and a hidden " home" ("TAKI TRAVEL home"). Symbol-only logos keep an aria-label | Fixed, verified |
| A-02 | P2 | `definition-list` / `dlitem` on booking details and payment | `BookingSummary` nested the Total row's `<dt>`/`<dd>` two `<div>`s deep inside `<dl>` | `BookingSummary.tsx`: flattened to a single wrapping div | Fixed, verified |
| A-03 | P2 | `label-content-name-mismatch` on both dashboards | The account-menu button showed the initials "AK", but its name was "Account menu for Arjun Kumar" | `TopBar.tsx`: the name is now "AK, Account menu for Arjun Kumar" | Fixed, verified |
| A-04 | P3 | No visible focus on the 4th Tab stop of date inputs (customer dashboard, Add Route), WCAG 2.4.7 | Chromium's calendar-picker button is an internal tab stop. There the host input matches neither `:focus` nor `:focus-visible`, and our picker overlay is transparent | `Input.tsx`: an extra ring on `has-[input[type=date]:focus-within]` (probed: `:focus-within` matches at that stop) | Fixed, verified |

## Spec corrections (false positives, not app defects)

| Check | Problem | Correction |
|---|---|---|
| Tap targets under 24 px on dashboard and shipments | Stretched-link cards: the anchor's text box is 18 px tall, but an absolute `::after` makes the whole card clickable | Skip anchors with an absolutely positioned `::after` whose card is at least 24×24 |
| Add Route error state "no invalid fields" | The form opens prefilled with valid example values, so Next produced no errors | Fill Available Capacity = 999999 before submitting |
| Add Route error "not announced" | The error "can't exceed total capacity" didn't match the detector's keyword regex, although it sits in a `role="alert"` element | Also accept FormField's `*-error` id and the keywords "exceed" / "can't" |

## Accepted limitations

- Toast hover-to-pause doesn't work while a modal is open, because the dialog makes the page outside it inert. Dismiss (×) works (V-12 fix), and toasts auto-dismiss.
- Contrast is covered by axe's `color-contrast` rule, which passes everywhere. Text drawn over the hero photograph sits on a gradient overlay; axe can't fully evaluate text over images, and a manual check was not performed.
- Screen-reader testing with real assistive technology (NVDA, TalkBack, VoiceOver) was **not** performed. Results come from axe plus DOM and keyboard automation only.
