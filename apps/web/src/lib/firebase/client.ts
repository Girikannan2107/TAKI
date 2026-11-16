"use client";

/**
 * The only module that imports the Firebase JS SDK (Auth only; the browser never talks to Firestore or
 * Storage). Two app instances (P2 §5.2):
 *
 *  - the MAIN app holds the session: `signInWithCustomToken(customToken)` after login / signup / reset;
 *    its ID token is the Bearer for every API call;
 *  - the "phone-proof" app runs phone OTP (invisible reCAPTCHA + `signInWithPhoneNumber`). Its ID token is
 *    a short-lived *phone proof* accepted only by phone status, signup, password reset and phone change.
 *    Keeping it separate means verifying a phone never replaces (or creates) the main session.
 *
 * Config values are NEXT_PUBLIC_* and therefore inlined at build time.
 * Local dev / e2e: NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 wires both instances to the Auth
 * emulator (no real SMS; codes are read from the emulator, reCAPTCHA is bypassed).
 */
import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  initializeAuth,
  type Auth,
  type Persistence,
} from "firebase/auth";

const PHONE_PROOF_APP = "phone-proof";

function firebaseOptions(): FirebaseOptions {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

/** Host:port of the Auth emulator, or null in staging / production. */
export function authEmulatorHost(): string | null {
  const v = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?.trim();
  return v ? v.replace(/^https?:\/\//, "") : null;
}

/** True when the build carries enough Firebase config to sign anyone in. */
export function firebaseConfigured(): boolean {
  const o = firebaseOptions();
  return !!o.apiKey && !!o.projectId;
}

function appNamed(name?: string): FirebaseApp {
  const existing = getApps().find((a) => a.name === (name ?? "[DEFAULT]"));
  if (existing) return existing;
  return name ? initializeApp(firebaseOptions(), name) : initializeApp(firebaseOptions());
}

const auths = new Map<string, Auth>();

function authFor(name: string | undefined, persistence: Persistence): Auth {
  const key = name ?? "[DEFAULT]";
  const cached = auths.get(key);
  if (cached) return cached;
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured: set NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
  }
  const app = appNamed(name);
  // initializeAuth (not getAuth) so persistence is fixed before any state is read; no popup/redirect resolver
  // is needed because TAKI only uses custom-token and phone sign-in.
  const auth = initializeAuth(app, { persistence });
  auth.languageCode = "en";
  const emu = authEmulatorHost();
  if (emu) {
    connectAuthEmulator(auth, `http://${emu}`, { disableWarnings: true });
    // The emulator never checks reCAPTCHA; skip the widget so local/e2e runs are not blocked by it.
    auth.settings.appVerificationDisabledForTesting = true;
  }
  auths.set(key, auth);
  return auth;
}

/** Main session (shared across tabs via IndexedDB/local persistence). */
export function mainAuth(): Auth {
  return authFor(undefined, browserLocalPersistence);
}

/**
 * Phone-proof instance. Session persistence: the proof survives a reload of the signup step in this tab
 * but never outlives the tab, and the backend only accepts it for 10 minutes anyway.
 */
export function phoneProofAuth(): Auth {
  return authFor(PHONE_PROOF_APP, browserSessionPersistence);
}
