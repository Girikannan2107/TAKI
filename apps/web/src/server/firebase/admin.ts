import "server-only";
/**
 * firebase-admin initialisation (P2 §1.2, §2.2). Initialised once (guarded by getApps()).
 *
 * Guards:
 *  - production + FIRESTORE_EMULATOR_HOST → refuse (except the Playwright build, TAKI_E2E=1);
 *  - non-production without emulator host or credentials → refuse with "Start the emulators".
 *  - With the emulator the project id is forced to "demo-taki"; the demo- prefix means the
 *    SDK can never reach a real project.
 */
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { env, isProduction } from "../env";

const APP_NAME = "taki";
export const EMULATOR_PROJECT_ID = "demo-taki";

export function getAdminApp(): App {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;

  const e = env();
  const emulator = Boolean(e.FIRESTORE_EMULATOR_HOST);
  if (emulator && e.NODE_ENV === "production" && !e.TAKI_E2E) {
    throw new Error("FIRESTORE_EMULATOR_HOST must not be set in production.");
  }
  const hasInlineCreds = Boolean(e.FIREBASE_CLIENT_EMAIL && e.FIREBASE_PRIVATE_KEY && e.FIREBASE_PROJECT_ID);
  const hasFileCreds = Boolean(e.GOOGLE_APPLICATION_CREDENTIALS);
  if (!emulator && !hasInlineCreds && !hasFileCreds) {
    throw new Error(
      isProduction()
        ? "Firebase credentials are missing (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)."
        : "Start the emulators: `npm run emulators` (and make sure .env.development sets FIRESTORE_EMULATOR_HOST).",
    );
  }

  const projectId = emulator ? EMULATOR_PROJECT_ID : e.FIREBASE_PROJECT_ID;
  const storageBucket = e.FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`;
  if (emulator) {
    return initializeApp({ projectId, storageBucket }, APP_NAME);
  }
  if (hasInlineCreds) {
    return initializeApp(
      {
        projectId,
        storageBucket,
        credential: cert({
          projectId: e.FIREBASE_PROJECT_ID,
          clientEmail: e.FIREBASE_CLIENT_EMAIL,
          privateKey: e.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        }),
      },
      APP_NAME,
    );
  }
  // GOOGLE_APPLICATION_CREDENTIALS → application default credentials.
  return initializeApp({ projectId, storageBucket }, APP_NAME);
}

const g = globalThis as unknown as { __takiFirestore?: Firestore };

/** Firestore with `ignoreUndefinedProperties`, configured once (HMR-safe). */
export function getAdminFirestore(): Firestore {
  if (g.__takiFirestore) return g.__takiFirestore;
  const db = getFirestore(getAdminApp());
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() throws if Firestore was already used; the first caller configured it.
  }
  g.__takiFirestore = db;
  return db;
}

export function getAdminBucket() {
  return getStorage(getAdminApp()).bucket();
}

export function hasAdminApp(): boolean {
  try {
    getApp(APP_NAME);
    return true;
  } catch {
    return false;
  }
}
