import "server-only";
/** Shared projections (P2 §4.4): the only code that turns these docs into JSON. */
import type { NotificationDTO, PaymentSummaryDTO, ReviewDTO } from "@/lib/api/contracts/common";
import { fileUrl } from "@/lib/api/contracts/common";
import type { FileRef } from "@/lib/domain/model";
import type { NotificationDoc, PaymentDoc, ReviewDoc } from "../db/schema";

export function toNotificationDTO(n: NotificationDoc): NotificationDTO {
  return { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt, readAt: n.readAt };
}

export function toReviewDTO(r: ReviewDoc): ReviewDTO {
  return { id: r.id, bookingId: r.bookingId, rating: r.rating, comment: r.comment, customerFirstName: r.customerFirstName, createdAt: r.createdAt };
}

export function toPaymentSummaryDTO(p: PaymentDoc): PaymentSummaryDTO {
  return {
    id: p.id,
    status: p.status,
    provider: p.provider,
    amountRupees: Math.round(p.amountPaise / 100),
    methodLabel: p.methodLabel,
    paidAt: p.confirmation && (p.status === "succeeded" || p.status.startsWith("refund")) ? p.confirmation.at : null,
    refund: p.refund ? { status: p.refund.status, amountRupees: Math.round(p.refund.amountPaise / 100), completedAt: p.refund.completedAt } : null,
  };
}

export function fileRefUrl(ref: FileRef | null | undefined): string | null {
  return ref ? fileUrl(ref.fileId) : null;
}

/** "Ravi Kumar" → "Ravi". */
export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

/** "+919876543210" → "+91 ••••• •3210". */
export function maskPhone(e164: string): string {
  const last4 = e164.slice(-4);
  return `+91 ••••• •${last4}`;
}
