/**
 * Authentication adapter contract. The demo adapter runs fully in the browser;
 * a Firebase Phone Auth adapter can implement the same interface later
 * (signInWithPhoneNumber + RecaptchaVerifier; it never returns `demoCode`).
 */
import type { Role, Session } from "@/lib/domain/types";
import type { AuthFlow } from "@/lib/store";

export interface SendOtpInput {
  /** 10-digit or +91 mobile number. */
  mobile: string;
  flow: AuthFlow;
  /** Required for flow "signup". */
  role?: Role;
  /** Return path to carry through the flow (already validated by the caller). */
  next?: string;
}

export interface SendOtpResult {
  challengeId: string;
  expiresAt: string;
  resendAvailableAt: string;
  /** DEMO ONLY: the code to display on screen. Never present in live mode. */
  demoCode?: string;
}

export type VerifyOtpResult =
  | { ok: true; flow: AuthFlow; session?: Session }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" | "no_challenge"; attemptsLeft?: number };

export interface CreateAccountInput {
  fullName: string;
  password: string;
  /** Drivers only — defaults to "<First name> Transport". */
  businessName?: string;
}

export interface AuthAdapter {
  readonly mode: "demo" | "live";
  sendOtp(input: SendOtpInput): Promise<SendOtpResult>;
  resendOtp(): Promise<SendOtpResult>;
  verifyOtp(code: string): Promise<VerifyOtpResult>;
  /** After a verified signup OTP. */
  createAccount(input: CreateAccountInput): Promise<Session>;
  /** After a verified reset OTP. */
  resetPassword(password: string): Promise<void>;
  login(input: { mobile: string; password: string }): Promise<Session>;
  logout(): Promise<void>;
}
