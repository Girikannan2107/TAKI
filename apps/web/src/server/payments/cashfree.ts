import "server-only";
/**
 * Cashfree PG adapter (P2 §9), sandbox and production. Reuses the signature / timestamp
 * helpers in `src/app/api/payments/cashfree/_lib/cashfree-server.ts`.
 *
 * Endpoints: POST {base}/orders, GET {base}/orders/{id}, GET {base}/orders/{id}/payments,
 * POST {base}/orders/{id}/refunds, GET {base}/orders/{id}/refunds/{refund_id}.
 * Secrets are read per call and never logged.
 */
import { isFreshTimestamp, readCashfreeConfig, verifyWebhookSignature, type CashfreeConfig } from "@/app/api/payments/cashfree/_lib/cashfree-server";
import { DomainError } from "@/lib/api/contracts/errors";
import { env } from "../env";
import type { GatewayEvent, OrderStatus, PaymentGateway } from "./gateway";

export function cashfreeBaseUrl(cfg: Pick<CashfreeConfig, "env">): string {
  return cfg.env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}

function headers(cfg: CashfreeConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    "x-client-id": cfg.appId,
    "x-client-secret": cfg.secretKey,
    "x-api-version": env().CASHFREE_API_VERSION,
  };
}

async function call<T>(cfg: CashfreeConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cashfreeBaseUrl(cfg)}${path}`, { method, headers: headers(cfg), body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  } catch {
    throw new DomainError("gateway_error");
  }
  const text = await res.text();
  if (!res.ok) {
    // Log status + Cashfree error code only (no secrets, no PII).
    let code = "";
    try {
      code = String((JSON.parse(text) as { code?: string }).code ?? "");
    } catch {
      code = "";
    }
    console.error(`[taki] cashfree ${method} ${path.split("/").slice(0, 2).join("/")} failed: ${res.status} ${code}`);
    throw new DomainError("gateway_error");
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const toPaise = (rupees: unknown): number | null => (typeof rupees === "number" ? Math.round(rupees * 100) : typeof rupees === "string" && rupees ? Math.round(Number(rupees) * 100) : null);

/** "+919876543210" → "9876543210" */
function tenDigits(e164: string): string {
  return e164.replace(/\D/g, "").slice(-10);
}

interface CfOrder {
  order_id: string;
  order_status: "ACTIVE" | "PAID" | "EXPIRED" | "TERMINATED" | "TERMINATION_REQUESTED" | string;
  order_amount: number;
  payment_session_id?: string;
}
interface CfPayment {
  cf_payment_id: string | number;
  payment_status: "SUCCESS" | "FAILED" | "PENDING" | "USER_DROPPED" | "CANCELLED" | "VOID" | string;
  payment_amount?: number;
  payment_group?: string;
  payment_method?: Record<string, Record<string, unknown>>;
}
interface CfRefund {
  refund_id: string;
  cf_refund_id?: string | number;
  refund_status: "SUCCESS" | "PENDING" | "CANCELLED" | "ONHOLD" | string;
}

/** Masked method label from Cashfree data (group + last digits only). */
export function methodLabelOf(p: Pick<CfPayment, "payment_group" | "payment_method">): string | null {
  const group = p.payment_group ? p.payment_group.replace(/_/g, " ") : null;
  const method = p.payment_method ? Object.values(p.payment_method)[0] : undefined;
  const card = method && typeof method.card_number === "string" ? method.card_number.replace(/\D/g, "").slice(-4) : "";
  if (!group) return null;
  return card ? `${group} ••${card}` : group;
}

function refundStatus(s: string): "pending" | "succeeded" | "failed" {
  if (s === "SUCCESS") return "succeeded";
  if (s === "CANCELLED") return "failed";
  return "pending";
}

export function cashfreeGateway(cfg: CashfreeConfig): PaymentGateway {
  return {
    provider: "cashfree",
    env: cfg.env,
    async createOrder(i) {
      const order = await call<CfOrder>(cfg, "POST", "/orders", {
        order_id: i.paymentId,
        order_amount: Number((i.amountPaise / 100).toFixed(2)),
        order_currency: "INR",
        customer_details: { customer_id: i.customer.id, customer_phone: tenDigits(i.customer.phone), customer_name: i.customer.name.slice(0, 100) },
        order_meta: { return_url: i.returnUrl, notify_url: i.notifyUrl },
        order_expiry_time: i.expiresAt,
      });
      if (!order.payment_session_id) throw new DomainError("gateway_error");
      return {
        checkout: { kind: "cashfree", mode: cfg.env, paymentSessionId: order.payment_session_id, orderId: i.paymentId },
        paymentSessionId: order.payment_session_id,
      };
    },
    async fetchOrderStatus(paymentId): Promise<OrderStatus> {
      const order = await call<CfOrder>(cfg, "GET", `/orders/${encodeURIComponent(paymentId)}`);
      const amountPaise = toPaise(order.order_amount);
      if (order.order_status === "PAID") {
        const payments = await call<CfPayment[]>(cfg, "GET", `/orders/${encodeURIComponent(paymentId)}/payments`).catch(() => [] as CfPayment[]);
        const ok = payments.find((p) => p.payment_status === "SUCCESS");
        return { status: "paid", amountPaise: ok ? toPaise(ok.payment_amount) ?? amountPaise : amountPaise, providerPaymentId: ok ? String(ok.cf_payment_id) : null, methodLabel: ok ? methodLabelOf(ok) : null, raw: "PAID" };
      }
      if (order.order_status === "EXPIRED" || order.order_status === "TERMINATED") return { status: "expired", amountPaise, providerPaymentId: null, methodLabel: null, raw: order.order_status };
      // ACTIVE: was the latest attempt a failure?
      const payments = await call<CfPayment[]>(cfg, "GET", `/orders/${encodeURIComponent(paymentId)}/payments`).catch(() => [] as CfPayment[]);
      const last = payments[payments.length - 1];
      if (last && (last.payment_status === "FAILED" || last.payment_status === "USER_DROPPED"))
        return { status: "failed", amountPaise, providerPaymentId: String(last.cf_payment_id), methodLabel: methodLabelOf(last), raw: `ACTIVE:${last.payment_status}` };
      return { status: "pending", amountPaise, providerPaymentId: null, methodLabel: null, raw: order.order_status };
    },
    verifyWebhook({ rawBody, headers: h, now }) {
      const signature = h.get("x-webhook-signature");
      const timestamp = h.get("x-webhook-timestamp");
      if (!signature || !timestamp || !verifyWebhookSignature({ timestamp, rawBody, signature, secret: cfg.secretKey })) return { ok: false, reason: "invalid_signature" };
      if (!isFreshTimestamp(timestamp, now.getTime())) return { ok: false, reason: "stale_timestamp" };
      return { ok: true, event: parseCashfreeEvent(rawBody) };
    },
    async refund(i) {
      const r = await call<CfRefund>(cfg, "POST", `/orders/${encodeURIComponent(i.paymentId)}/refunds`, {
        refund_amount: Number((i.amountPaise / 100).toFixed(2)),
        refund_id: i.refundId,
        refund_note: i.reason.slice(0, 100),
      });
      return { status: refundStatus(r.refund_status), providerRefundId: r.cf_refund_id !== undefined ? String(r.cf_refund_id) : null };
    },
    async fetchRefundStatus(i) {
      const r = await call<CfRefund>(cfg, "GET", `/orders/${encodeURIComponent(i.paymentId)}/refunds/${encodeURIComponent(i.refundId)}`);
      return refundStatus(r.refund_status);
    },
  };
}

/** Parse a verified webhook body. Unknown types → null (acknowledged, ignored). */
export function parseCashfreeEvent(rawBody: string): GatewayEvent | null {
  let body: { type?: string; data?: { order?: { order_id?: string; order_amount?: number }; payment?: CfPayment; refund?: CfRefund & { order_id?: string } } };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return null;
  }
  const type = body.type ?? "";
  const data = body.data ?? {};
  if (type === "REFUND_STATUS_WEBHOOK" && data.refund?.refund_id) {
    const orderId = data.refund.order_id ?? data.order?.order_id ?? "";
    return {
      type: "refund_status",
      orderId,
      refundId: data.refund.refund_id,
      status: refundStatus(data.refund.refund_status),
      providerRefundId: data.refund.cf_refund_id !== undefined ? String(data.refund.cf_refund_id) : null,
      eventKey: `${type}:${orderId}:${data.refund.refund_id}:${data.refund.refund_status}`,
    };
  }
  const orderId = data.order?.order_id;
  const p = data.payment;
  if (!orderId || !p) return null;
  const map: Record<string, "payment_succeeded" | "payment_failed" | "payment_dropped"> = {
    PAYMENT_SUCCESS_WEBHOOK: "payment_succeeded",
    PAYMENT_FAILED_WEBHOOK: "payment_failed",
    PAYMENT_USER_DROPPED_WEBHOOK: "payment_dropped",
  };
  const t = map[type];
  if (!t) return null;
  return {
    type: t,
    orderId,
    providerPaymentId: p.cf_payment_id !== undefined ? String(p.cf_payment_id) : null,
    amountPaise: toPaise(p.payment_amount ?? data.order?.order_amount),
    methodLabel: methodLabelOf(p),
    eventKey: `${type}:${orderId}:${p.cf_payment_id ?? ""}`,
  };
}

/** The configured Cashfree gateway, or null when credentials are missing. */
export function readCashfreeGateway(): PaymentGateway | null {
  const cfg = readCashfreeConfig();
  return cfg ? cashfreeGateway(cfg) : null;
}
