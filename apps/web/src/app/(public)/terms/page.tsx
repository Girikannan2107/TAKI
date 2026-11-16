import type { Metadata } from "next";
import { LegalPage, OwnerText, type LegalSection } from "@/features/legal/LegalPage";

export const metadata: Metadata = { title: "Terms of Service", description: "The rules for using TAKI as a customer, travel agency or driver." };

const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About TAKI",
    body: (
      <>
        <p>TAKI is a marketplace that connects people who need to ship goods with travel agencies whose vehicles already travel a route and have spare space. TAKI does not own or operate vehicles.</p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts",
    body: (
      <>
        <ul><li>One mobile number is one account. You verify it with a one-time code and log in with your password.</li><li>You must be 18 or older to create an account.</li><li>Keep your password private. You are responsible for activity on your account.</li></ul>
      </>
    ),
  },
  {
    id: "bookings",
    title: "Bookings and payments",
    body: (
      <>
        <ul><li>A booking request is not confirmed until the agency accepts it and your payment succeeds.</li><li>Prices are shown line by line before you pay. Payments are processed by Cashfree; TAKI never sees your card or bank details.</li></ul>
      </>
    ),
  },
  {
    id: "agencies",
    title: "Agencies and drivers",
    body: (
      <>
        <p>Agencies must be verified by TAKI before they can publish trips. Drivers are approved by their agency and verified by TAKI before they are assigned.</p>
      </>
    ),
  },
  {
    id: "prohibited",
    title: "Prohibited goods",
    body: (
      <>
        <OwnerText>the list of goods that may not be shipped (hazardous, illegal and restricted items).</OwnerText>
      </>
    ),
  },
  {
    id: "liability",
    title: "Liability",
    body: (
      <>
        <OwnerText>limits of liability, claims process and insurance position.</OwnerText>
      </>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <>
        <OwnerText>governing law, jurisdiction and the registered business details of TAKI.</OwnerText>
      </>
    ),
  },
];

/** M5 policy page (static). The owner supplies the final wording. */
export default function TermsPage() {
  return <LegalPage title="Terms of Service" summary="The rules for using TAKI as a customer, travel agency or driver." sections={SECTIONS} />;
}
