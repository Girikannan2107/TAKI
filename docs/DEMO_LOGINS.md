# Demo logins (local testing only)

These accounts exist only in the **local Firebase emulator**. `npm run seed` creates them. They are not real accounts and they never exist in a production database.

## Start the app with demo data

```bash
# 1. Java 21 must be on PATH (the Firebase emulators need it)
npm run emulators              # terminal 1 — Firestore + Storage emulators
npm run seed -- --reset        # terminal 2 — wipe and load the demo data
npm run dev                    # terminal 2 — http://localhost:3000
```

Re-run `npm run seed -- --reset` whenever you want fresh, today-dated demo data. Running it also writes the full account list to `apps/web/.data/seed-accounts.txt`.

## Password and OTPs

| What | Value |
|---|---|
| Password, every demo account | **`Taki@2026`** |
| Phone OTP (signup, forgot password, change phone) | **`123456`** |
| Driver pickup code (the customer reads it out at pickup) | **`111111`** |
| Driver delivery code (the receiver reads it out at delivery) | **`222222`** |

The OTPs are fixed because `apps/web/.env.development` sets `DEV_FIXED_OTPS=true`, and `next dev` and the seed both read that file. In dev the phone OTP is also shown on screen, labelled **Dev OTP**.

**Never in production.** Fixed OTPs work only when the server is not in production mode. A production server with `DEV_FIXED_OTPS` set refuses to start. A production build also refuses the dev SMS and dev payment providers.

## Main accounts, one per role

| Role | Login page | Phone | Who / what to try |
|---|---|---|---|
| **Customer** | `/auth/login` → Customer tab | `9876543210` | Priya Raman. Has bookings in every status: confirmed pickups on today's trip (Erode), in transit, delivered + reviewed, a pending request, a rejection. |
| **Travel agency** | `/auth/login` → Travel agency tab | `9876543220` | Kovai Freight Lines (verified, Coimbatore). Runs the Coimbatore → Chennai trips, has pending requests, earnings and a settlement. |
| **Driver** | `/auth/login` → Driver tab | `9876543211` | Ravi Kumar (approved, Kovai). Has a trip in progress today: picked-up, out-for-delivery and confirmed shipments, plus delivered history with proof photos. |
| **Admin** | `/admin/login` (not linked anywhere) | `9000000001` | TAKI Ops. Verify or reject pending agencies and drivers, mark settlements settled. |

## Other seeded accounts

| Role | Phone | Name | State |
|---|---|---|---|
| Agency | 9000000201 | Arjun Subramanian | Chennai Cargo Movers (verified) |
| Agency | 9000000301 | Anitha Joseph | Kochi Coastal Logistics (**pending**: use it to test admin verification) |
| Driver | 9000000111 | Murugan Selvam | Approved (Kovai) |
| Driver | 9000000115 | Ganesh Pandian | Approved (Kovai) |
| Driver | 9000000113 | Senthil Nathan | **Awaiting agency approval** (Kovai) |
| Driver | 9000000211 | Imran Basha | Approved (Chennai) |
| Driver | 9000000212 | Prakash Raj | Approved (Chennai) |
| Driver | 9000000311 | Joby Thomas | **Awaiting agency approval** (Kochi) |
| Customer | 9000000402 | Karthik Iyer | Has bookings |
| Customer | 9000000403 | Fathima Beevi | Has bookings |
| Customer | 9000000404 | Suresh Babu | Has bookings |

All of them use password `Taki@2026`.

## Quick test walkthrough

1. **Customer:** sign in as `9876543210` and open **My Shipments**. A confirmed shipment shows pickup code `111111` and delivery code `222222`.
2. **Driver:** sign in as `9876543211`, open **Assigned Shipments**, pick a confirmed shipment and confirm pickup with `111111`. Later, deliver it with `222222` and a photo.
3. **Agency:** sign in as `9876543220` and open **Bookings** to accept or reject requests.
4. **New accounts:** sign up any unused 10-digit number (for example `9123400050`) and enter OTP `123456`.
5. **Admin:** go to `/admin/login`, sign in as `9000000001`, open the pending agency **Kochi Coastal Logistics** and verify it.
6. **Payments:** the dev payment page moves no money. Click **Approve** or **Decline**.

## Notes

- Five wrong passwords lock an account for 15 minutes. If a demo account gets locked, run `npm run seed -- --reset`.
- The browser tests (`npm run test:e2e`) run against a production build and do **not** use fixed phone OTPs. They read the on-screen Dev OTP instead.
