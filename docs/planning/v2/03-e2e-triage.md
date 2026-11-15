# E2E triage (desktop, Firestore emulator), 2026-11-14

How to run: `npm run test:e2e:build`, then `npm run test:e2e -- --project=desktop <specs>`. Java must be on PATH (see 02-agent-brief).

**Only the lead runs Playwright.** Dev agents fix from this file plus the log and do not run Playwright themselves.

## Progress

| Run | Module specs (10 files) | Notes |
|---|---|---|
| 1 | many failures | Dev SMS was refused under TAKI_E2E (fixed in c35deb6). Wrong-password tests locked the shared demo customer (fixed in c35deb6). |
| 2 | 62 pass / 14 fail | Every upload returned 500 with "i is not a constructor": a sync `require` of an async module in filestore.ts (fixed). |
| 3 | **65 pass / 11 fail / 3 skipped** | No server errors left. Log: `C:/Users/girik/AppData/Local/Temp/claude/9be19317dd793892/fce04893-cea2-4650-a26d-67ac69ce9389/scratchpad/e2e-v2-modules2.log` |

## Remaining failures, by owner

### D1 auth/admin
- `admin.spec.ts:100`: on the admin login, the wrong-credentials message "Phone number or password is incorrect." never appears. Check the admin login error copy and the API error mapping.
- `admin.spec.ts:167`: reject an agency with a reason. After creating a pending agency, `getByRole("link", { name: agencyName })` is not visible in the admin list. Possible causes: list refresh, pagination, or the tab filter.
- `auth.spec.ts:97`: agency signup lands on `/agency/dashboard` instead of `/agency/profile/verification?onboarding=1`. The post-signup redirect for agencies is wrong, or the D2 dashboard redirects onward. Decide with D2 which side owns it.
- `auth.spec.ts:191`: `page.goto("/auth/login")` fails with net::ERR_ABORTED (frame detached). Probably a navigation race in the test after a client redirect: wait for the URL or load state before the next goto.

### D2 agency
- `agency-journey.spec.ts:16`: `/agency` stays at `/agency` and never reaches `/agency/dashboard`. Check the index redirect (server `redirect()` versus a client redirect).
- `agency-journey.spec.ts:115`: the profile has no heading named "Agency details".
- `agency-journey.spec.ts:61`: `getByRole("radio", { name: "Closed" })` never becomes visible or enabled (body-type choice on the vehicle form).
- `agency-bookings.spec.ts:47`: strict mode. `getByLabel('Reason')` and `getByText('Choose a reason')` each match both the select's placeholder option and the error span. Either change the placeholder wording or scope the locators.
- `agency-trips.spec.ts:46`: strict mode. `getByLabel('Vehicle')` resolves to both the select and a region whose accessible name contains "Vehicle". Scope the locator or rename the region.

### D3 customer
- `customer-journey.spec.ts:54`: guest picks a vehicle → "Log in to request" → after login, expected `/customer/shipments/new?…trip=<id>`, but the test timed out. Verify the `next` round trip, including D1's safeRedirect, and New Shipment's `?trip=` handling.

### D4 driver
- `driver-app.spec.ts:84`: pickup. In the OTP dialog, `getByLabel("Digit 1 of 6")` is not found. Check that the pickup sheet renders OtpInput, with D1's per-digit labels, inside a dialog with the expected name. D4's uncommitted TripRunView change (committed in c35deb6) was in progress when the agent paused.

## Still Phase 1 (Wave 3 rewrite, not part of these runs)
`integration.spec.ts`, `responsive-a11y.spec.ts`, `visual.spec.ts`.
