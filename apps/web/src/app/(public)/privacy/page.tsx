import type { Metadata } from "next";
import { LegalPage, OwnerText, type LegalSection } from "@/features/legal/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy", description: "What TAKI collects, why, and how it is protected." };

const SECTIONS: LegalSection[] = [
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <ul><li>Account details: name, mobile number, date of birth (customers) and your password (stored only as a secure hash).</li><li>Shipment details: addresses, receiver name and number, and package information.</li><li>Agency and driver verification documents and photos, stored privately.</li></ul>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use it",
    body: (
      <>
        <p>To run your account, match shipments with trips, process payments and refunds, and send in-app updates about your bookings.</p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who sees what",
    body: (
      <>
        <ul><li>Agencies see a customer&apos;s contact details only after accepting a booking; drivers see them only once the booking is paid.</li><li>Identity document numbers are always shown masked.</li></ul>
      </>
    ),
  },
  {
    id: "location",
    title: "Location",
    body: (
      <>
        <p>TAKI never tracks your location. If you choose &quot;Use current location&quot;, your browser shares your position once to fill in the address.</p>
      </>
    ),
  },
  {
    id: "retention",
    title: "Retention and your rights",
    body: (
      <>
        <OwnerText>retention periods, how to request a copy or deletion of your data, and the grievance officer contact.</OwnerText>
      </>
    ),
  },
];

/** M5 policy page (static). The owner supplies the final wording. */
export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" summary="What TAKI collects, why, and how it is protected." sections={SECTIONS} />;
}
