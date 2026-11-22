# TAKI Travel — Smart Logistics Marketplace

TAKI Travel connects customers who need to ship goods with travel agencies whose vehicles already run that route with spare space. Customers search on their route, compare prices and book only the space they need; agencies publish trips, accept requests and track earnings; drivers run the trip from their phone.

- **Web** (`apps/web`): Next.js 16.4, React 19, TypeScript, Tailwind CSS v4. UI only: every rule runs in the API.
- **API** (`backend`): FastAPI (Python 3.12) on Firestore + Firebase Storage + Firebase Auth. Contract: [docs/v3/P2-api-contract.md](docs/v3/P2-api-contract.md).
- **Firebase** (`firebase/`): emulator config, Firestore/Storage rules and indexes.
- Payments: Cashfree (a dev-only "Test payment" gateway exists for local/e2e). Places and routes: Google Maps (a fake gazetteer is used locally without a key). Phone OTP: Firebase Auth.

## Run locally

Requirements: Node.js 22+, Python 3.12 (`py -3.12` on Windows), Java 21 (Firebase emulators). Full guide: [docs/v3/local-setup.md](docs/v3/local-setup.md).

```bash
npm ci --prefix apps/web
py -3.12 -m venv backend/.venv && backend/.venv/Scripts/python -m pip install -r backend/requirements-dev.txt
cp backend/.env.example backend/.env

npm run dev:all      # emulators (auth 9099, firestore 8080, storage 9199) + FastAPI :8000 + Next :3000
```

The database starts empty. Create the first admin with `backend/scripts/create_admin.py`, then sign up customers, agencies and drivers in the app; see [docs/DEMO_LOGINS.md](docs/DEMO_LOGINS.md).

## Commands

| Command (repo root) | What it does |
|---|---|
| `npm run dev:all` | Emulators + API + web together (`--no-emulators`, `--no-api`, `--no-web`) |
| `npm run emulators` | Firebase emulators only (data kept in `firebase/.data/emulators`) |
| `npm run dev` | Next.js dev server only (proxies `/api/v1` to `http://127.0.0.1:8000`) |
| `npm run build` / `npm run start` | Production build / serve of the web app |
| `npm run check` | Web typecheck + lint + unit tests |
| `npm run test:e2e` | Playwright (starts FastAPI :8010 + Next :3010; needs running emulators). Pass args: `npm run test:e2e -- --project=desktop tests/e2e/auth.spec.ts` |
| `npm run rules:deploy` | Deploy Firestore rules/indexes and Storage rules |
| `backend/.venv/Scripts/python -m pytest backend/tests -q` | API tests (emulator suites skip when the emulators are down) |

## Layout

```
apps/web/        Next.js app: src/app (pages), src/features (views), src/components, src/lib (API client, Firebase Auth, maps)
                 tests/unit (Vitest), tests/e2e (Playwright), apphosting.yaml (Firebase App Hosting)
backend/         FastAPI app (app/), tests/, scripts/create_admin.py, Dockerfile (Cloud Run)
firebase/        firebase.json, rules, indexes; emulator data in .data/ (gitignored)
scripts/dev.mjs  local runner
docs/            v3 architecture, API contract, setup and deployment guides; docs/assets = design sources
```

## Configuration

- Web: `apps/web/.env.example` lists every `NEXT_PUBLIC_*` (Firebase web config, Auth emulator host, API base URL, Maps browser key, dev gateway flag). Local defaults are in `apps/web/.env.development`.
- API: `backend/.env.example` (emulators, payments, maps, secrets). Production values come from Secret Manager ([docs/v3/deploy.md](docs/v3/deploy.md)).
