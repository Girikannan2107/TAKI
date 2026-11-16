/** Firebase Auth error code → user-facing message (P3 §3.4). Unknown codes fall back to a generic line. */
const MESSAGES: Record<string, string> = {
  "auth/invalid-verification-code": "That code is incorrect. Check the SMS and try again.",
  "auth/missing-verification-code": "Enter the 6-digit code.",
  "auth/code-expired": "This code has expired. Request a new one.",
  "auth/session-expired": "This code has expired. Request a new one.",
  "auth/invalid-verification-id": "This verification has expired. Enter your number again.",
  "auth/missing-verification-id": "This verification has expired. Enter your number again.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/quota-exceeded": "We can't send more codes right now. Please try again later.",
  "auth/invalid-phone-number": "Enter a valid 10-digit mobile number.",
  "auth/missing-phone-number": "Enter your mobile number.",
  "auth/captcha-check-failed": "We couldn't confirm you're not a robot. Reload the page and try again.",
  "auth/invalid-app-credential": "We couldn't confirm you're not a robot. Reload the page and try again.",
  "auth/network-request-failed": "You appear to be offline. Check your connection and try again.",
  "auth/user-disabled": "This account has been disabled. Contact TAKI support.",
  "auth/invalid-custom-token": "Your sign-in link expired. Please log in again.",
  "auth/operation-not-allowed": "Phone sign-in is not enabled for this project.",
  "auth/web-storage-unsupported": "Your browser blocks storage that sign-in needs. Allow site data and try again.",
};

export function firebaseErrorCode(e: unknown): string | null {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
    const code = (e as { code: string }).code;
    return code.startsWith("auth/") ? code : null;
  }
  return null;
}

export function isFirebaseAuthError(e: unknown): boolean {
  return firebaseErrorCode(e) !== null;
}

export function firebaseErrorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  const code = firebaseErrorCode(e);
  return (code && MESSAGES[code]) || fallback;
}
