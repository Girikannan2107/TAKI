"use client";
import { appMode } from "@/lib/config/env";
import { DomainError } from "@/lib/domain/db";
import { demoAuthAdapter } from "./demo-auth";
import type { AuthAdapter } from "./types";

const notConfigured = (): never => {
  throw new DomainError("auth_not_configured", "Live sign-in is not configured for this deployment.");
};

/**
 * Placeholder for live mode. A Firebase Phone Auth adapter implementing AuthAdapter
 * belongs here; until it exists live mode fails loudly instead of faking auth.
 */
const liveAuthAdapter: AuthAdapter = {
  mode: "live",
  sendOtp: async () => notConfigured(),
  resendOtp: async () => notConfigured(),
  verifyOtp: async () => notConfigured(),
  createAccount: async () => notConfigured(),
  resetPassword: async () => notConfigured(),
  login: async () => notConfigured(),
  logout: async () => notConfigured(),
};

/** Active auth adapter (demo unless NEXT_PUBLIC_APP_MODE=live). */
export const authService: AuthAdapter = appMode === "live" ? liveAuthAdapter : demoAuthAdapter;

export type { AuthAdapter, SendOtpResult, VerifyOtpResult, CreateAccountInput } from "./types";
