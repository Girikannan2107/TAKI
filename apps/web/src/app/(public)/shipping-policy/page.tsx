import type { Metadata } from "next";
import { LegalPage, OwnerText, type LegalSection } from "@/features/legal/LegalPage";

export const metadata: Metadata = { title: "Shipping & Delivery Policy", description: "How goods move from pickup to delivery on TAKI." };

const SECTIONS: LegalSection[] = [
  {
    id: "area",
    title: "Service area",
    body: (
      <>
        <p>TAKI serves Tamil Nadu, Kerala, Karnataka, Telangana and Andhra Pradesh. Pickup and drop must be on a published trip&apos;s route.</p>
      </>
    ),
  },
  {
    id: "pickup",
    title: "Pickup",
    body: (
      <>
        <p>The driver collects the goods at the agreed stop and time. You share your pickup code with the driver to confirm the handover.</p>
      </>
    ),
  },
  {
    id: "tracking",
    title: "Tracking",
    body: (
      <>
        <p>You see every stop the driver checks in and out of. TAKI shows the planned route only; it never shows a live vehicle position.</p>
      </>
    ),
  },
  {
    id: "delivery",
    title: "Delivery",
    body: (
      <>
        <p>The receiver shares the delivery code with the driver, who records proof of delivery.</p>
      </>
    ),
  },
  {
    id: "timing",
    title: "Delivery times",
    body: (
      <>
        <OwnerText>commitments on delivery windows and what happens when a trip is delayed.</OwnerText>
      </>
    ),
  },
];

/** M5 policy page (static). The owner supplies the final wording. */
export default function ShippingPolicyPage() {
  return <LegalPage title="Shipping & Delivery Policy" summary="How goods move from pickup to delivery on TAKI." sections={SECTIONS} />;
}
