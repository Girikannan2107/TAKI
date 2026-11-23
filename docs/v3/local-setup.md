# TAKI v3: local setup

Windows 11, macOS or Linux. Everything runs locally against the Firebase emulators; no cloud project or real keys are needed.

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 22 LTS (20+ works) | `node -v` |
| Python | **3.12** (the machine default may be 3.14; use the launcher) | `py -3.12 -V` (Windows) / `python3.12 -V` |
| Java | 21 (Firestore/Storage emulators) | `java -version` |
| Docker Desktop | optional, only to build the API image | `docker version` |

## One-time setup

```bash
# frontend (also installs firebase-tools as a devDependency)
npm ci --prefix apps/web

# backend virtualenv (Windows paths shown; use backend/.venv/bin/python on macOS/Linux)
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements-dev.txt

# backend config: emulator defaults, dev test-payment gateway, fake maps
cp backend/.env.example backend/.env
```

## Run everything

```bash
node scripts/dev.mjs
```

| Prefix | Process | URL |
|---|---|---|
| `[emu]` | Firebase emulators (auth 9099, firestore 8080, storage 9199), data kept in `firebase/.data/emulators` | UI http://127.0.0.1:4000 |
| `[api]` | `uvicorn app.main:app --reload` from `backend/` | http://127.0.0.1:8000/api/v1/health, docs at `/docs` |
| `[web]` | `next dev` in `apps/web` | http://localhost:3000 |

Ctrl+C stops all three. Flags: `--no-emulators` (reuse running emulators or a real project), `--no-api`, `--no-web`. Already-running emulators on the same ports are reused.

## Payments and maps locally

- `PAYMENT_PROVIDER=dev` (default in `.env.example`): checkout opens the **Test payment** page (no money moves); Approve/Decline go through the same confirmation path as Cashfree. It is refused outside `development`/`test`.
- Real Cashfree sandbox: set `PAYMENT_PROVIDER=cashfree`, `CASHFREE_ENV=sandbox`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` in `backend/.env`. Webhooks cannot reach `localhost`; the return page's verify call and the sweep's reconcile confirm payments instead (or use a tunnel and set `PUBLIC_API_BASE_URL` to it).
- Without `GOOGLE_MAPS_SERVER_KEY`, the API uses the deterministic **fake gazetteer** (about 45 real towns; place ids `fake_<town>`). Put a restricted dev server key in `backend/.env` to use Google.

## Tests

```bash
# backend: unit tests + emulator tests (emulators must be running, or wrap with emulators:exec)
backend/.venv/Scripts/python -m pytest backend/tests -q
npx -y firebase-tools@latest emulators:exec --config firebase/firebase.json --only auth,firestore,storage \
  --project demo-taki "backend/.venv/Scripts/python -m pytest backend/tests -q"

# lint
backend/.venv/Scripts/python -m ruff check backend

# frontend
npm --prefix apps/web run check
```

Emulator-backed tests are marked `@pytest.mark.emulator` and skip when the Firestore emulator is not reachable.

## Docker image

```bash
docker build -t taki-api backend
docker run --rm -p 8080:8080 --env-file backend/.env taki-api
```
(From inside a container, emulator hosts must point at `host.docker.internal` instead of `127.0.0.1`.)
