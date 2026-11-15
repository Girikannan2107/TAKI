"use client";

import { useSyncExternalStore } from "react";
import type { OtpChallengeDTO, OtpVerifyResultDTO } from "@/lib/api/contracts/auth";
import type { IsoDate, PublicRole, StateCode, VehicleCountRange } from "@/lib/domain/model";

/**
 * Short-lived client draft for the multi-page signup / recovery flow (P3 §4.2). Lives in sessionStorage
 * (this tab only) so a reload keeps the step; cleared on success. Holds no password.
 */
export type AuthFlowKind = "signup" | "reset";

export interface CustomerDraft {
  fullName: string;
  dob: IsoDate;
}
export interface AgencyDraft {
  ownerName: string;
  agencyName: string;
  districtId: string;
  vehicleCountRange: VehicleCountRange;
  statesCovered: StateCode[];
}
export interface DriverDraft {
  fullName: string;
  agencyId: string;
  /** "Agency name — District", for display only. */
  agencyLabel: string;
}

export type SignupDraft =
  | { role: "customer"; details: CustomerDraft; acceptTerms: true }
  | { role: "agency"; details: AgencyDraft; acceptTerms: true }
  | { role: "driver"; details: DriverDraft; acceptTerms: true };

export interface PendingOtp {
  flow: AuthFlowKind;
  role: PublicRole;
  /** 10-digit national number as typed (for "Change number" prefill). */
  mobile: string;
  challenge: OtpChallengeDTO;
  next?: string;
}

export interface VerifiedProof extends OtpVerifyResultDTO {
  flow: AuthFlowKind;
  role: PublicRole;
  mobile: string;
  next?: string;
}

export interface AuthFlowState {
  draft: SignupDraft | null;
  otp: PendingOtp | null;
  proof: VerifiedProof | null;
}

const KEY = "taki:auth-flow:v2";
const EMPTY: AuthFlowState = { draft: null, otp: null, proof: null };

let cache: AuthFlowState | null = null;
const listeners = new Set<() => void>();

function read(): AuthFlowState {
  if (cache) return cache;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<AuthFlowState>) } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: AuthFlowState) {
  cache = next;
  try {
    if (!next.draft && !next.otp && !next.proof) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota: the in-memory copy still works for this page view.
  }
  for (const l of listeners) l();
}

export const authFlow = {
  get: (): AuthFlowState => read(),
  setDraft(draft: SignupDraft) {
    const s = read();
    // A new draft for another role invalidates any half-finished phone verification.
    const sameRole = s.draft?.role === draft.role;
    write({ draft, otp: sameRole ? s.otp : null, proof: sameRole ? s.proof : null });
  },
  setOtp(otp: PendingOtp) {
    write({ ...read(), otp, proof: null });
  },
  updateChallenge(challenge: OtpChallengeDTO) {
    const s = read();
    if (s.otp) write({ ...s, otp: { ...s.otp, challenge } });
  },
  setProof(proof: VerifiedProof) {
    write({ ...read(), proof });
  },
  clearOtp() {
    write({ ...read(), otp: null, proof: null });
  },
  clear() {
    write(EMPTY);
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** `null` during SSR / before hydration, then the stored flow state. */
export function useAuthFlow(): AuthFlowState | null {
  return useSyncExternalStore(
    subscribe,
    () => read(),
    () => null,
  );
}

/** True when a proof token is still usable (with a small safety margin). */
export function proofUsable(p: VerifiedProof | null, nowMs = Date.now()): p is VerifiedProof {
  return !!p && Date.parse(p.expiresAt) - 15_000 > nowMs;
}
