# Test accounts (local)

There is no seed and no demo password any more: the database starts **empty** and every account is created the way a real user would create it. Everything below runs against the local Firebase emulators (`npm run dev:all` or `npm run emulators`); none of it works against production.

## First admin

The admin console has no public signup. Create the first admin from `backend/`:

```bash
cd backend
TAKI_ADMIN_PASSWORD='<a password>' .venv/Scripts/python -m scripts.create_admin --phone +919000000001 --name "Ops Admin"
```

Set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and `FIREBASE_PROJECT_ID=demo-taki` first (they are in `backend/.env.example`). The script refuses a second admin unless you pass `--force`. Log in at `/admin/login`.

## Customers, agencies and drivers

Sign up in the app (`/signup`), with any 10-digit mobile number starting 6–9:

1. Enter the details, then the mobile number. The Auth emulator sends no SMS.
2. Read the 6-digit code from the emulator: the Emulator UI (http://127.0.0.1:4000, Authentication tab), or
   `curl http://127.0.0.1:9099/emulator/v1/projects/demo-taki/verificationCodes` (latest entry for your number).
3. Choose a password (8+ characters, a letter and a number). Daily login is phone + password at `/auth/login`.

Useful order for an end-to-end run:

- **Agency:** sign up, upload the owner photo and one identity document (`/agency/profile/verification`), then verify it as admin (`/admin/agencies`). Add a vehicle with its RC, invite a driver by phone (`/agency/drivers/new`).
- **Driver:** sign up with the invited number and choose "My agency added me (invite)"; upload the licence, Aadhaar and photo; verify as admin (`/admin/drivers`).
- **Trip:** the verified agency adds and publishes a trip (`/agency/trips/new`).
- **Customer:** sign up, create a shipment, request a vehicle; the agency accepts; pay with the **Test payment** page (local only, no money moves); the driver picks up with the customer's pickup code and delivers with the receiver's code.

Forgot password: `/auth/phone?flow=reset` (same emulator code). Five wrong passwords lock an account for 15 minutes.

Without `GOOGLE_MAPS_SERVER_KEY` the API uses a fake gazetteer of real towns (place ids `fake_<town>`, e.g. Coimbatore, Salem, Chennai, Kochi, Bengaluru); type the town name and press **Find** in address and stop fields.
