# TAKI v3: deployment guide

Owner: D5. Applies [00-target-architecture.md](00-target-architecture.md), [P2-architecture.md](P2-architecture.md) §4, §10, §16 and [P3-workflow-ui-deploy.md](P3-workflow-ui-deploy.md) §5.

| Piece | Where | How it ships |
|---|---|---|
| Frontend `apps/web` (Next.js 16) | Firebase App Hosting, root directory `apps/web` | App Hosting rolls out the live branch automatically |
| Backend `backend/` (FastAPI) | Cloud Run service `taki-api`, `asia-south1` | `.github/workflows/deploy-backend.yml` (Docker image in Artifact Registry) |
| Firestore rules + indexes, Storage rules | `firebase/` | `.github/workflows/deploy-firebase.yml` |
| Sweep (expiry, payment reconcile, refund jobs) | Cloud Scheduler → `POST /api/v1/internal/sweep` | one-time `gcloud scheduler` command (below) |

Nothing here has been deployed. Every value in angle brackets (`<project>`, `<domain>`) is a placeholder that the owner fills in. Use separate projects for staging (`taki-staging`) and production (`taki-prod`); repeat every step for each.

Firebase CLI commands use `npx -y firebase-tools@latest` (no global install needed). `gcloud` is the Google Cloud CLI.

---

## 1. Firebase project (once per environment)

1. Create the project, then upgrade it to the **Blaze** plan. Cloud Run, Secret Manager, App Hosting and phone auth outside the free quota all need billing.
   ```bash
   npx -y firebase-tools@latest projects:create <project> --display-name "TAKI (prod)"
   ```
2. **Firestore**: Native mode, location **`asia-south1`** (Mumbai; owner confirmed; this cannot be changed later).
   ```bash
   gcloud firestore databases create --project <project> --location asia-south1 --type firestore-native
   ```
   Add TTL policies on `expiresAt` for `idempotencyKeys`, `rateLimits`, `geocodeCache`, `distanceCache` and `routeCache` (Console → Firestore → TTL).
3. **Storage**: default bucket in `asia-south1`. Rules stay deny-all for clients (`firebase/storage.rules`).
4. **Authentication** (Console → Authentication → Sign-in method):
   - **Phone**: ON. **Email/Password**: OFF (daily login is phone + password verified by FastAPI, then a custom token).
   - **SMS region policy**: allow only `IN`. Add a budget alert for Identity Platform SMS.
   - **Authorised domains**: `localhost` (staging only), `<domain>`, `www.<domain>`, the App Hosting `*.hosted.app` domain of this backend, and the staging custom domain. Phone-auth reCAPTCHA fails on any domain that is not listed.
   - **reCAPTCHA**: the web SDK uses invisible reCAPTCHA automatically. Optional: Identity Platform + reCAPTCHA Enterprise SMS defense.
   - **Test phone numbers** (Phone → "Phone numbers for testing"): **staging only**, for example `+91 90000 10001` / `246810` (customer), `…10002` (agency), `…10003` (driver). Never in production; never give one the admin role.
5. **Rules and indexes**: run `deploy-firebase.yml`, or locally:
   ```bash
   npx -y firebase-tools@latest deploy --config firebase/firebase.json \
     --only firestore:rules,firestore:indexes,storage --project <project>
   ```
6. **First admin** (the database starts empty):
   `backend/.venv/Scripts/python backend/scripts/create_admin.py --project <project> --phone +91… --name "TAKI Ops"` with ADC of a project owner.

## 2. Google Cloud resources (once per environment)

```bash
PROJECT=<project>; REGION=asia-south1
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  geocoding-backend.googleapis.com routes.googleapis.com --project $PROJECT

# Artifact Registry (Docker)
gcloud artifacts repositories create taki --repository-format docker --location $REGION --project $PROJECT

# Service accounts
gcloud iam service-accounts create taki-api       --project $PROJECT --display-name "TAKI API (Cloud Run runtime)"
gcloud iam service-accounts create taki-deployer  --project $PROJECT --display-name "TAKI GitHub deployer"
gcloud iam service-accounts create taki-scheduler --project $PROJECT --display-name "TAKI sweep invoker"
```

### 2.1 IAM

| Service account | Roles |
|---|---|
| `taki-api@` (runtime) | `roles/datastore.user`; `roles/firebaseauth.admin`; `roles/storage.objectAdmin` on the bucket only; `roles/secretmanager.secretAccessor` on the TAKI secrets only; `roles/iam.serviceAccountTokenCreator` **on itself** (needed by `create_custom_token` on Cloud Run); `roles/logging.logWriter` |
| `taki-deployer@` (GitHub Actions) | `roles/run.developer`; `roles/artifactregistry.writer` on repo `taki`; `roles/iam.serviceAccountUser` on `taki-api@`; `roles/firebaserules.admin`; `roles/datastore.indexAdmin`; `roles/firebasestorage.admin` |
| `taki-scheduler@` | none on the project; it only mints the OIDC token for the sweep |

```bash
API=taki-api@$PROJECT.iam.gserviceaccount.com
for r in roles/datastore.user roles/firebaseauth.admin roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding $PROJECT --member serviceAccount:$API --role $r; done
gcloud iam service-accounts add-iam-policy-binding $API --member serviceAccount:$API \
  --role roles/iam.serviceAccountTokenCreator --project $PROJECT
gcloud storage buckets add-iam-policy-binding gs://<bucket> --member serviceAccount:$API --role roles/storage.objectAdmin
```

### 2.2 Workload Identity Federation (keyless GitHub → GCP)

```bash
gcloud iam workload-identity-pools create github --location global --project $PROJECT
gcloud iam workload-identity-pools providers create-oidc github-oidc --location global \
  --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.repository == '<owner>/<repo>'" --project $PROJECT
gcloud iam service-accounts add-iam-policy-binding taki-deployer@$PROJECT.iam.gserviceaccount.com \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/github/attribute.repository/<owner>/<repo>" \
  --project $PROJECT
```
For production, tighten the condition to `assertion.ref == 'refs/heads/main'` and protect the `production` GitHub environment with a required reviewer.

### 2.3 Secret Manager

Create each secret once, then add versions. Never put values in git, GitHub or workflow files.

| Secret | Env var | Notes |
|---|---|---|
| `file-url-secret` | `FILE_URL_SECRET` | ≥ 32 random bytes |
| `pii-hash-key` | `PII_HASH_KEY` | ≥ 32 random bytes. **Never rotate** once data exists |
| `otp-enc-key` | `OTP_ENC_KEY` | Fernet key |
| `password-pepper` | `PASSWORD_PEPPER` | optional; create it anyway (the workflow mounts it) |
| `cashfree-app-id` | `CASHFREE_APP_ID` | sandbox in staging, production in prod |
| `cashfree-secret-key` | `CASHFREE_SECRET_KEY` | also verifies webhook signatures |
| `maps-server-key` | `GOOGLE_MAPS_SERVER_KEY` | server key (§5) |

```bash
printf '%s' "$(openssl rand -base64 48)" | gcloud secrets create file-url-secret --data-file=- --replication-policy automatic --project $PROJECT
gcloud secrets add-iam-policy-binding file-url-secret --member serviceAccount:$API --role roles/secretmanager.secretAccessor --project $PROJECT
```
Until the owner provides Cashfree keys, do **not** store placeholder values: a non-empty placeholder counts as "configured" and every order would fail at Cashfree. Leave the two `cashfree-*` lines out of `deploy-backend.yml` for that environment instead, so payments answer `501 payments_not_configured`.

## 3. Backend: Cloud Run `taki-api`

`backend/Dockerfile`: `python:3.12-slim`, non-root user (uid 10001), `pip install -r requirements.txt`, `gunicorn` with uvicorn workers on `$PORT` (8080). Build locally: `docker build -t taki-api backend`.

`deploy-backend.yml` (push to `main` touching `backend/**`, or manual dispatch with `staging` / `production`):
1. WIF auth as `taki-deployer@` → `gcloud auth configure-docker asia-south1-docker.pkg.dev`
2. `docker build` + push `asia-south1-docker.pkg.dev/<project>/taki/api:<sha>`
3. `deploy-cloudrun@v2`: service `taki-api`, region `asia-south1`, runtime SA `taki-api@`, public (auth is in the app), 1 vCPU / 512 Mi, concurrency 40, max 10 instances, timeout 60 s, CPU boost; min instances from `vars.MIN_INSTANCES` (**1 in production** so Cashfree webhooks and the payment return page never hit a cold start; 0 in staging)
4. Smoke test `GET /api/v1/health`

The API refuses to start in `production` if any `*_EMULATOR_HOST` is set, if `PAYMENT_PROVIDER` ≠ `cashfree`, or if a required secret is missing or shorter than 32 characters.

**Custom domain** `api.<domain>`: Cloud Run domain mappings are not offered in every region. If `asia-south1` lacks them, put a global external HTTPS load balancer with a serverless NEG in front (this also enables Cloud Armor), or use the `*.run.app` URL. Owner choice.

### 3.1 GitHub configuration (per environment: Settings → Environments → `staging` / `production` → Variables)

| Variable | Example |
|---|---|
| `GCP_PROJECT_ID` | `taki-prod` |
| `GCP_REGION` | `asia-south1` |
| `GCP_WIF_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/github/providers/github-oidc` |
| `GCP_DEPLOY_SA` | `taki-deployer@taki-prod.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SA` | `taki-api@taki-prod.iam.gserviceaccount.com` |
| `ARTIFACT_REPO` | `taki` |
| `FIREBASE_STORAGE_BUCKET` | `taki-prod.firebasestorage.app` |
| `APP_ORIGIN` | `https://www.<domain>` |
| `PUBLIC_API_BASE_URL` | `https://api.<domain>` |
| `CORS_ALLOWED_ORIGINS` | `https://www.<domain>,https://<backend>.hosted.app` |
| `CASHFREE_ENV` | **required**, no default: `production` for production (the workflow and the API refuse `sandbox` there); `sandbox` allowed for staging |
| `SWEEP_OIDC_AUDIENCE` | the Cloud Run service URL |
| `SWEEP_INVOKER_EMAILS` | `taki-scheduler@taki-prod.iam.gserviceaccount.com` |
| `MIN_INSTANCES` | `1` (production) / `0` (staging) |

There are **no GitHub secrets**: WIF replaces JSON keys and runtime secrets stay in Secret Manager.

### 3.2 Cloud Scheduler (sweep)

```bash
gcloud scheduler jobs create http taki-sweep --project $PROJECT --location $REGION \
  --schedule "*/5 * * * *" --time-zone "Asia/Kolkata" --http-method POST \
  --uri "https://api.<domain>/api/v1/internal/sweep" \
  --oidc-service-account-email taki-scheduler@$PROJECT.iam.gserviceaccount.com \
  --oidc-token-audience "<SWEEP_OIDC_AUDIENCE>"
```
The app verifies the Google-signed token (audience and email). Correctness never depends on the sweep: expiry is also checked lazily inside transactions.

## 4. Payments: Cashfree

- **Environments**: sandbox keys in staging (`CASHFREE_ENV=sandbox`), production keys in production. Both come from Secret Manager.
- **Webhook**: Cashfree dashboard → Developers → Webhooks → add `https://api.<domain>/api/v1/payments/cashfree/webhook` (staging: the staging API URL). Events: `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`, `PAYMENT_USER_DROPPED_WEBHOOK`, `REFUND_STATUS_WEBHOOK`; API version `2025-01-01`. Each order also carries `order_meta.notify_url` (built from `PUBLIC_API_BASE_URL`), so the path change from v2 (`/api/payments/...` → `/api/v1/payments/...`) needs no other dashboard change.
- **Signature**: `base64(HMAC-SHA256(secret, x-webhook-timestamp + raw body))`, compared in constant time; timestamps older than 300 s are rejected. A verified webhook only *triggers* a `GET /orders/{id}` check; the API answer decides.
- **Domain whitelisting** (production checkout): Developers → Whitelisting → add `www.<domain>` (and the `*.hosted.app` domain if customers use it).
- **Return URL**: `APP_ORIGIN/customer/payment/return?paymentId=…` must be `https` in production.
- **Activation**: Cashfree needs the Terms, Privacy, Refund and Shipping pages and a working contact page.
- **Dev gateway**: `PAYMENT_PROVIDER=dev` is a TEST gateway for local development and e2e only. The API refuses to start with it outside `development` / `test`, and every checkout it returns is labelled "Test payment". Never set it in staging or production.

## 5. Google Maps Platform

| Key | Application restriction | API restriction | Where |
|---|---|---|---|
| Browser `maps-browser-key` | HTTP referrers: `https://www.<domain>/*`, `https://<domain>/*`, the exact `*.hosted.app` host(s), the staging domain. A separate dev key for `http://localhost:3000/*` | Maps JavaScript API, Places API (New) | App Hosting env (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, BUILD + RUNTIME), `apps/web/.env.local` |
| Server `maps-server-key` | none by default (Cloud Run egress IPs are dynamic); optional Direct VPC egress + Cloud NAT static IP, then an IP restriction | Geocoding API, Routes API | Secret Manager → `GOOGLE_MAPS_SERVER_KEY`. Never in the frontend or the repo |

Set per-API daily quotas and a billing budget alert. The API caches geocodes and route results for 30 days and place ids indefinitely (owner default #16). Quota or key errors surface as `502 maps_unavailable`; a missing key in staging/production as `503 maps_not_configured`. In development/test without a key, the deterministic FAKE gazetteer is used and is labelled as such in the logs.

## 6. Frontend: Firebase App Hosting

```bash
npx -y firebase-tools@latest apphosting:backends:create --project <project>
```
Connect the GitHub repo, root directory **`apps/web`**, live branch `main` (staging: `develop` or manual rollouts), region `asia-south1` if offered (else `asia-southeast1`). Do not set `output: "standalone"`. Grant the backend access to the browser-key secret:
```bash
npx -y firebase-tools@latest apphosting:secrets:grantaccess maps-browser-key --backend <backend> --project <project>
```
Manual rollout: `npx -y firebase-tools@latest apphosting:rollouts:create <backend> --git-branch main --project <project>`.

## 7. Environment variables

### 7.1 Backend (`backend/.env` locally; Cloud Run env + Secret Manager in the cloud). Full list with comments: `backend/.env.example`.

| Var | Local (emulators) | Staging / production | Secret |
|---|---|---|---|
| `APP_ENV` | `development` | `staging` / `production` | no |
| `LOG_LEVEL`, `LOG_JSON` | `INFO`, `false` | `INFO`, `true` | no |
| `FIREBASE_PROJECT_ID` | `demo-taki` | real id | no |
| `FIREBASE_STORAGE_BUCKET` | `demo-taki.appspot.com` | `<id>.firebasestorage.app` | no |
| `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` | `127.0.0.1:8080` / `:9099` / `:9199` | **unset** | no |
| `APP_ORIGIN` | `http://localhost:3000` | `https://www.<domain>` | no |
| `PUBLIC_API_BASE_URL` | `http://localhost:8000` | `https://api.<domain>` | no |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | web origins | no |
| `TRUST_PROXY_HEADERS` | `false` | `true` | no |
| `FILE_URL_SECRET`, `PII_HASH_KEY`, `OTP_ENC_KEY`, `PASSWORD_PEPPER` | generated dev values | Secret Manager | **yes** |
| `GOOGLE_MAPS_SERVER_KEY` | unset (fake) or a dev key | Secret Manager | **yes** |
| `MAPS_PROVIDER` | `auto` | `google` | no |
| `MAPS_REGION`, `MAPS_LANGUAGE`, `SERVICE_STATES` | `in`, `en-IN`, `TN,KL,KA,TG,AP` | same | no |
| `PAYMENT_PROVIDER` | `dev` (test gateway) or `cashfree` | `cashfree` | no |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` | sandbox keys or unset | Secret Manager | **yes** |
| `CASHFREE_ENV` | `sandbox` | `sandbox` → `production` | no |
| `CASHFREE_API_VERSION` | `2025-01-01` | same | no |
| `CASHFREE_WEBHOOK_TOLERANCE_SECONDS`, `CASHFREE_TIMEOUT_SECONDS` | `300`, `10` | same | no |
| `DEV_PAYMENT_SECRET` | optional | **unset** | yes |
| `SWEEP_OIDC_AUDIENCE`, `SWEEP_INVOKER_EMAILS` | unset | service URL, scheduler SA | no |
| `CRON_SECRET` | any | optional | **yes** |
| `REQUIRE_*`, `DEV_AUTO_VERIFY`, `RATE_LIMITS_ENABLED` | defaults | defaults; `DEV_AUTO_VERIFY=false` | no |
| `PORT`, `WEB_CONCURRENCY` | — | set by Cloud Run / Dockerfile | no |

### 7.2 Frontend (`apps/web`; all public)

| Var | Local | Production (App Hosting `apphosting.yaml`) |
|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | `local` | `production` |
| `NEXT_PUBLIC_API_BASE_URL` | `http://127.0.0.1:8000` (or `/api` with the Next rewrite) | `https://api.<domain>` |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | emulator values (`demo-key`, `demo-taki`, …) | from the Firebase web app config |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | `127.0.0.1:9099` | **unset** |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | dev key in `.env.local` (optional) | secret `maps-browser-key` |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | optional | optional |
| `NEXT_PUBLIC_ENABLE_DEV_GATEWAY` | `true` | **unset** |

## 8. Release checklist

- [ ] Staging: Cashfree sandbox order → pay → webhook → booking `paid`; failed and user-dropped paths; a refund settles.
- [ ] Staging: geocode, reverse geocode and trip route preview work with the real server key; quotas set.
- [ ] `GET /api/v1/health/ready` reports `payments: configured`, `maps: configured`.
- [ ] Production: `PAYMENT_PROVIDER=cashfree`, `CASHFREE_ENV=production`, no emulator variables, `MIN_INSTANCES=1`.
- [ ] Cashfree production webhook URL and domain whitelist set; test numbers absent from production Auth.
