"use client";

/**
 * Firebase phone OTP in the "phone-proof" app instance (P2 §5.3, P3 §3.4).
 *
 *   const { verificationId } = await sendPhoneOtp("9876543210", anchorEl);   // invisible reCAPTCHA + SMS
 *   await confirmPhoneOtp(verificationId, "123456");                           // proof user signed in
 *   const token = await phoneProofToken();                                     // Bearer for E4–E7, E9; X-Phone-Proof for E16
 *   await clearPhoneProof();                                                   // after the flow finishes
 *
 * The verification id is a plain string, so the multi-page flow keeps it in sessionStorage; the proof user
 * itself lives in the phone-proof instance (session persistence). The backend accepts the proof only while
 * `auth_time` is at most 10 minutes old (PHONE_PROOF_MAX_AGE_MS).
 */
import { PhoneAuthProvider, RecaptchaVerifier, signInWithCredential, signInWithPhoneNumber, signOut } from "firebase/auth";
import { ApiError } from "@/lib/api/http";
import { phoneProofAuth } from "@/lib/firebase/client";

export const PHONE_PROOF_MAX_AGE_MS = 10 * 60_000;

/** "9876543210" → "+919876543210". */
export function toE164India(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  return `+91${digits.slice(-10)}`;
}

/** "+91 ••••• •3210" (same mask the API uses). */
export function maskIndianMobile(mobile: string): string {
  const d = mobile.replace(/\D/g, "").slice(-10);
  return `+91 ••••• •${d.slice(-4)}`;
}

/**
 * Sends the SMS. `anchor` is an empty element that hosts the invisible reCAPTCHA; a fresh verifier is
 * created per attempt and always cleared afterwards (resend = call this again).
 */
export async function sendPhoneOtp(mobile: string, anchor: HTMLElement): Promise<{ verificationId: string; phoneE164: string }> {
  const auth = phoneProofAuth();
  const phoneE164 = toE164India(mobile);
  const verifier = new RecaptchaVerifier(auth, anchor, { size: "invisible" });
  try {
    const confirmation = await signInWithPhoneNumber(auth, phoneE164, verifier);
    return { verificationId: confirmation.verificationId, phoneE164 };
  } finally {
    verifier.clear();
  }
}

/** Confirms the code; on success the phone-proof instance holds a phone-verified user. */
export async function confirmPhoneOtp(verificationId: string, code: string): Promise<{ phoneE164: string; verifiedAt: number }> {
  const auth = phoneProofAuth();
  const cred = await signInWithCredential(auth, PhoneAuthProvider.credential(verificationId, code));
  return { phoneE164: cred.user.phoneNumber ?? "", verifiedAt: Date.now() };
}

/** True while a proof user exists and its sign-in is fresh enough for the backend. */
export function phoneProofFresh(verifiedAt: number | null | undefined, nowMs = Date.now()): boolean {
  return !!verifiedAt && nowMs - verifiedAt < PHONE_PROOF_MAX_AGE_MS - 15_000;
}

/** ID token of the phone-proof user; throws ApiError `phone_proof_required` when there is none. */
export async function phoneProofToken(): Promise<string> {
  const auth = phoneProofAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user || !user.phoneNumber) {
    throw new ApiError("phone_proof_required", 401, "Your phone verification has expired. Verify your number again.");
  }
  return user.getIdToken();
}

export async function clearPhoneProof(): Promise<void> {
  try {
    await signOut(phoneProofAuth());
  } catch {
    // Nothing to clear (or Firebase not configured).
  }
}
