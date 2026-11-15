import "server-only";
/**
 * Dev payment gateway (P2 §9). NOTHING auto-succeeds: `createOrder` only returns a URL to the
 * "Dev payment gateway — no money moves" page, whose Approve / Decline buttons call
 * POST /api/payments/dev/confirm with the per-payment dev token. Without that explicit
 * server-side step the payment stays `pending` until it expires.
 *
 * The dev token is derived (HMAC of the payment id with a key from SESSION_SECRET), so a
 * replayed create returns the same URL without storing the token in plaintext; only its
 * hash is stored on the payment.
 */
import { createHash, createHmac } from "node:crypto";
import { sessionSecret } from "../env";
import { safeEqual } from "../http/crypto";
import type { OrderStatus, PaymentGateway } from "./gateway";

function devKey(): string {
  return createHmac("sha256", sessionSecret()).update("taki-dev-payments-v1").digest("hex");
}

/** Deterministic per-payment token (base64url, 32 chars). */
export function devTokenFor(paymentId: string): string {
  return createHmac("sha256", devKey()).update(paymentId).digest("base64url").slice(0, 32);
}

export function devTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function devTokenMatches(paymentId: string, token: string, storedHash: string | undefined): boolean {
  if (!storedHash) return false;
  return safeEqual(devTokenHash(token), storedHash) && safeEqual(token, devTokenFor(paymentId));
}

export function devGatewayUrl(paymentId: string, token: string): string {
  return `/customer/payment/dev-gateway?paymentId=${encodeURIComponent(paymentId)}&token=${encodeURIComponent(token)}`;
}

export const devGateway: PaymentGateway = {
  provider: "dev",
  env: "dev",
  async createOrder(i) {
    const devToken = devTokenFor(i.paymentId);
    return { checkout: { kind: "dev", url: devGatewayUrl(i.paymentId, devToken), devToken } };
  },
  /** The dev gateway has no state of its own: only the explicit Approve/Decline call confirms. */
  async fetchOrderStatus(): Promise<OrderStatus> {
    return { status: "pending", amountPaise: null, providerPaymentId: null, methodLabel: null, raw: "dev:pending" };
  },
  /** Dev refunds complete immediately (still run through the job runner). */
  async refund(i) {
    return { status: "succeeded", providerRefundId: `devrf_${i.refundId}` };
  },
  async fetchRefundStatus() {
    return "succeeded";
  },
};
