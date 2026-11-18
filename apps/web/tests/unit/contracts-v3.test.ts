import { describe, expect, it, vi } from "vitest";
import type { AuthResultDTO, PhoneStatusDTO, PlaceDTO, SessionUserDTO } from "@/lib/api/contracts/auth";
import type { AdminPaymentRowDTO } from "@/lib/api/contracts/admin";
import type { CreatePaymentOrderResponse, PaymentStatusResponse } from "@/lib/api/contracts/payments";
import type { AddressRequest } from "@/lib/api/contracts/customer";
import { AddressRequestSchema } from "@/lib/api/contracts/customer";
import { AdditionalChargesSchema } from "@/lib/api/contracts/agency";

vi.mock("@/lib/firebase/client", () => ({ firebaseConfigured: () => false, mainAuth: () => null, phoneProofAuth: () => null }));

const { maskIndianMobile, phoneProofFresh, toE164India, PHONE_PROOF_MAX_AGE_MS } = await import("@/lib/auth/phone-otp");
const { linesOf } = await import("@/features/booking/BookingSummary");
const { parseCharges, newChargeRow } = await import("@/features/pricing/AdditionalChargesEditor");
const { checkpointIssuesV3 } = await import("@/features/agency/checkpoint-rules");

/**
 * Contract check: payloads shaped exactly like the FastAPI responses (backend/app/schemas/*, camelCase)
 * must satisfy the hand-written DTOs the UI reads. `satisfies` makes `tsc` fail on drift.
 */
const place = {
  placeId: "fake_coimbatore",
  name: "Coimbatore",
  formattedAddress: "Coimbatore, Tamil Nadu 641001, India",
  lat: 11.0168,
  lng: 76.9558,
  locality: "Coimbatore",
  district: "Coimbatore",
  state: "TN",
  stateName: "Tamil Nadu",
  pincode: "641001",
} satisfies PlaceDTO;

const user = {
  id: "Xy12AbC",
  role: "agency",
  name: "Kavitha",
  phoneMasked: "+91 ••••• •3220",
  photoUrl: null,
  agency: { id: "agc_abcdefghijklmnopqrst", name: "Kovai Freight", verification: "not_submitted", reason: null },
  driver: null,
  claimsVersion: 1,
} satisfies SessionUserDTO;

const auth = { customToken: "eyJ...", user } satisfies AuthResultDTO;
const status = { phone: "+919876543210", phoneMasked: "+91 ••••• •3210", registered: false, role: null, invite: null } satisfies PhoneStatusDTO;

const devOrder = {
  paymentId: "pay_abcdefghijklmnopqrst",
  provider: "dev",
  amountRupees: 4850,
  expiresAt: "2026-11-17T10:00:00Z",
  checkout: { kind: "dev", mode: "test", label: "Test payment", orderId: "ord_1", devToken: "x".repeat(32), url: "/customer/payment/dev-gateway?paymentId=pay_x&token=y" },
  reused: false,
  testPayment: true,
} satisfies CreatePaymentOrderResponse;

const cfOrder = {
  paymentId: "pay_abcdefghijklmnopqrst",
  provider: "cashfree",
  amountRupees: 4850,
  expiresAt: "2026-11-17T10:00:00Z",
  checkout: { kind: "cashfree", mode: "sandbox", paymentSessionId: "session_abc", orderId: "ord_2" },
  reused: true,
} satisfies CreatePaymentOrderResponse;

const paymentStatus = {
  paymentId: "pay_abcdefghijklmnopqrst",
  bookingId: "TAKI00000001",
  status: "succeeded",
  bookingStatus: "confirmed",
  bookingState: { approvalStatus: "accepted", paymentStatus: "paid", reservationStatus: "committed", fulfilmentStatus: "not_started", closure: null },
  amountRupees: 4850,
  provider: "cashfree",
  methodLabel: "UPI",
  failureReason: null,
  refund: null,
  testPayment: false,
} satisfies PaymentStatusResponse;

const adminRow = {
  id: "pay_abcdefghijklmnopqrst",
  bookingId: "TAKI00000001",
  customerId: "uid1",
  agencyId: "agc_abcdefghijklmnopqrst",
  status: "refund_failed",
  amountRupees: 4850,
  failureReason: null,
  cfOrderStatus: "PAID",
  refund: { status: "failed", amountRupees: 4850 },
  createdAt: "2026-11-17T10:00:00Z",
  updatedAt: "2026-11-17T11:00:00Z",
} satisfies AdminPaymentRowDTO;

describe("v3 contracts", () => {
  it("sample payloads type-check against the DTOs", () => {
    expect([place, auth, status, devOrder, cfOrder, paymentStatus, adminRow].every(Boolean)).toBe(true);
  });

  it("AddressRequest needs the field that matches its source", () => {
    const base: AddressRequest = { line1: "12 Main Road", pincode: "641001", state: "TN", source: "autocomplete" };
    expect(AddressRequestSchema.safeParse(base).success).toBe(false);
    expect(AddressRequestSchema.safeParse({ ...base, placeId: "fake_coimbatore" }).success).toBe(true);
    expect(AddressRequestSchema.safeParse({ ...base, source: "current_location", location: { lat: 11, lng: 77 } }).success).toBe(true);
    expect(AddressRequestSchema.safeParse({ ...base, source: "manual" }).success).toBe(true);
  });

  it("additional charges: max 5, unique labels, ₹0–5,000", () => {
    const c = (label: string, amountRupees = 100) => ({ label, amountRupees, basis: "per_booking" as const });
    expect(AdditionalChargesSchema.safeParse([c("Loading"), c("loading")]).success).toBe(false);
    expect(AdditionalChargesSchema.safeParse([c("A1"), c("A2"), c("A3"), c("A4"), c("A5"), c("A6")]).success).toBe(false);
    expect(AdditionalChargesSchema.safeParse([c("Toll", 5001)]).success).toBe(false);
    expect(AdditionalChargesSchema.safeParse([c("Toll", 250)]).success).toBe(true);
  });
});

describe("phone helpers", () => {
  it("formats Indian numbers", () => {
    expect(toE164India("98765 43210")).toBe("+919876543210");
    expect(maskIndianMobile("9876543210")).toBe("+91 ••••• •3210");
  });
  it("treats a proof as fresh for (almost) 10 minutes", () => {
    const now = 1_000_000_000;
    expect(phoneProofFresh(now - 60_000, now)).toBe(true);
    expect(phoneProofFresh(now - PHONE_PROOF_MAX_AGE_MS, now)).toBe(false);
    expect(phoneProofFresh(null, now)).toBe(false);
  });
});

describe("pricing lines", () => {
  const p = {
    pricingVersion: 3 as const,
    distanceKm: 498,
    weightKg: 500,
    ratePerKmPaise: 750,
    ratePerKgPaise: 153,
    distanceCharge: 3735,
    weightCharge: 765,
    transportationCharge: 4500,
    handlingFee: 200,
    additionalCharges: 200,
    serviceFee: 350,
    totalPayable: 5050,
    lines: [] as never[],
  };
  it("uses the server lines when present", () => {
    const lines = [
      { code: "distance" as const, label: "Distance charge", amount: 3735 },
      { code: "weight" as const, label: "Weight charge", amount: 765 },
      { code: "additional" as const, label: "Loading", amount: 200 },
      { code: "service_fee" as const, label: "TAKI service fee", amount: 350 },
    ];
    expect(linesOf({ ...p, lines })).toBe(lines);
  });
  it("rebuilds lines that sum to the total for old snapshots", () => {
    const lines = linesOf(p);
    expect(lines.map((l) => l.code)).toEqual(["distance", "weight", "additional", "service_fee"]);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(p.totalPayable);
  });
});

describe("pricing form helpers", () => {
  it("parses charge rows and reports row errors", () => {
    expect(parseCharges([{ ...newChargeRow(), label: "Loading", amount: "200" }]).charges).toEqual([{ label: "Loading", amountRupees: 200, basis: "per_booking" }]);
    const bad = parseCharges([{ ...newChargeRow(), label: "x", amount: "" }]);
    expect(bad.charges).toBeNull();
    expect(Object.keys(bad.errors).sort()).toEqual(["0.amount", "0.label"]);
  });
});

describe("checkpoint rules (place ids)", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 11, 1, h)).toISOString();
  it("accepts an ordered route and flags missing places, repeats and time order", () => {
    const ok = [
      { placeId: "fake_coimbatore", label: "Coimbatore", expectedArrivalAt: null, expectedDepartureAt: at(1) },
      { placeId: "fake_salem", label: "Salem", expectedArrivalAt: at(4), expectedDepartureAt: at(5) },
      { placeId: "fake_chennai", label: "Chennai", expectedArrivalAt: at(10), expectedDepartureAt: null },
    ];
    expect(checkpointIssuesV3(ok)).toEqual([]);
    const issues = checkpointIssuesV3([ok[0]!, { ...ok[0]!, expectedArrivalAt: at(0), expectedDepartureAt: null }]);
    expect(issues.map((i) => i.path)).toContain("checkpoints.1.placeId");
    expect(issues.map((i) => i.path)).toContain("checkpoints.1.expectedArrivalAt");
    expect(checkpointIssuesV3([{ ...ok[0]!, placeId: "" }, ok[2]!]).map((i) => i.path)).toContain("checkpoints.0.placeId");
  });
});
