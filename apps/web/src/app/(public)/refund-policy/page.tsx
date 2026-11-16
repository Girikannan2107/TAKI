import type { Metadata } from "next";
import { LegalPage, OwnerText, type LegalSection } from "@/features/legal/LegalPage";

export const metadata: Metadata = { title: "Refund & Cancellation Policy", description: "When you can cancel a booking and how refunds work." };

const SECTIONS: LegalSection[] = [
  {
    id: "before-pickup",
    title: "Cancelling before pickup",
    body: (
      <>
        <p><strong>Confirmed rule:</strong> you can cancel any booking before the goods are picked up. If you already paid, you receive a <strong>full refund, including the TAKI service fee</strong>.</p>
      </>
    ),
  },
  {
    id: "agency",
    title: "If the agency cancels or rejects",
    body: (
      <>
        <p>If the agency rejects your request, nothing is charged. If it cancels a trip after you paid, you receive a full refund.</p>
      </>
    ),
  },
  {
    id: "pickup-refused",
    title: "If pickup is refused",
    body: (
      <>
        <OwnerText>refund terms when a driver refuses pickup because the goods do not match the booking.</OwnerText>
      </>
    ),
  },
  {
    id: "after-pickup",
    title: "After pickup",
    body: (
      <>
        <p>Once the goods are picked up, the booking can no longer be cancelled in the app. <OwnerText>claims process for damaged or lost goods.</OwnerText></p>
      </>
    ),
  },
  {
    id: "timeline",
    title: "Refund timeline",
    body: (
      <>
        <p>Refunds go back to the original payment method through Cashfree. <OwnerText>expected refund timeline in working days.</OwnerText></p>
      </>
    ),
  },
];

/** M5 policy page (static). The owner supplies the final wording. */
export default function RefundPolicyPage() {
  return <LegalPage title="Refund & Cancellation Policy" summary="When you can cancel a booking and how refunds work." sections={SECTIONS} />;
}
