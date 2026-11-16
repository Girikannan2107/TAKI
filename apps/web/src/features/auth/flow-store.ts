"use client";

import { useSyncExternalStore } from "react";
import type { PhoneStatusDTO } from "@/lib/api/contracts/auth";
import { phoneProofFresh } from "@/lib/auth/phone-otp";
import type { IsoDate, PublicRole, StateCode, VehicleCountRange } from "@/lib/domain/model";

/**
 * Short-lived client draft for the multi-page signup / recovery flow (P3 §3.4). Lives in sessionStorage
 * (this tab only) so a reload keeps the step; cleared on success. Holds no password and no token: the
 * phone-proof user itself lives in the Firebase "phone-proof" instance (lib/auth/phone-otp.ts).
 */
export type AuthFlowKind = "signup" | "reset";

export interface CustomerDraft {
  fullName: string;
  dob: IsoDate;
}
export interface AgencyDraft {
  ownerName: string;
  agencyName: string;
  /** Agency base: Google place id (or `fake_*` locally) + the text shown to the user. */
  base: { placeId: string; label: string };
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
  phoneMasked: string;
  /** Firebase `ConfirmationResult.verificationId`. */
  verificationId: string;
  /** Epoch ms of the last SMS request (30 s resend cooldown). */
  sentAt: number;
  next?: string;
}

/** A phone verified in the phone-proof instance, plus what E4 said about it. */
export interface VerifiedProof {
  flow: AuthFlowKind;
  role: PublicRole;
  mobile: string;
  phoneMasked: string;
  /** Epoch ms of the OTP confirmation; the API accepts the proof for 10 minutes. */
  verifiedAt: number;
  registered: boolean;
  accountRole: PhoneStatusDTO["role"];
  /** Driver signup: a pending agency invite for this phone. */
  invite: PhoneStatusDTO["invite"];
  next?: string;
}

export interface AuthFlowState {
  draft: SignupDraft | null;
  otp: PendingOtp | null;
  proof: VerifiedProof | null;
}

const KEY = "taki:auth-flow:v3";
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
  /** After a resend: new verification id and cooldown start. */
  updateOtp(patch: Pick<PendingOtp, "verificationId" | "sentAt">) {
    const s = read();
    if (s.otp) write({ ...s, otp: { ...s.otp, ...patch } });
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

/** True while the phone proof is fresh enough for the API (10 minutes, with a safety margin). */
export function proofUsable(p: VerifiedProof | null, nowMs = Date.now()): p is VerifiedProof {
  return !!p && phoneProofFresh(p.verifiedAt, nowMs);
}
