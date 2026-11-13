import type { ReactNode } from "react";
import { ChevronDown, ClipboardList, Mail, Plus } from "lucide-react";
import { ButtonLink, Card } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { paths } from "@/lib/config/routes";
import { PRICING_PREVIEW_WEIGHT_KG } from "@/lib/domain/constants";
import { quote } from "@/lib/domain/pricing";
import { formatINR, formatKg, formatKm, formatRate } from "@/lib/format";

const CONTACT_EMAIL = "hello@taki.example";

// Worked example computed with the real pricing maths (498 km, ₹12/km, ₹0.50/kg, 500 kg).
const EXAMPLE = { distanceKm: 498, weightKg: PRICING_PREVIEW_WEIGHT_KG, ratePerKmPaise: 1200, ratePerKgPaise: 50 };
const EXAMPLE_QUOTE = quote(EXAMPLE);

interface Faq {
  id: string;
  question: string;
  answer: ReactNode;
}

const FAQS: Faq[] = [
  {
    id: "verification",
    question: "Why can't I publish trips yet?",
    answer: (
      <>
        <p>
          TAKI verifies every agency before its trips are listed. Upload your identity document and photo under Profile → Verification.
          Meanwhile you can add vehicles and drivers and save trips as drafts.
        </p>
        <p>Once TAKI verifies your documents, the Publish button unlocks. If verification is rejected, the reason is shown on your dashboard.</p>
      </>
    ),
  },
  {
    id: "pricing",
    question: "How is my price calculated?",
    answer: (
      <>
        <p>
          You set two rates for each trip: a per-kilometre rate and a per-kilogram rate. For every booking, your earnings are the
          distance the customer&apos;s goods travel on your route multiplied by your per-km rate, plus the weight multiplied by your per-kg rate.
        </p>
        <p>
          Example: {formatKm(EXAMPLE.distanceKm)} × {formatRate(EXAMPLE.ratePerKmPaise)} = {formatINR(EXAMPLE_QUOTE.distanceCharge)}, plus{" "}
          {formatKg(EXAMPLE.weightKg)} × {formatRate(EXAMPLE.ratePerKgPaise)} = {formatINR(EXAMPLE_QUOTE.weightCharge)}. You earn{" "}
          <strong className="font-semibold text-ink">{formatINR(EXAMPLE_QUOTE.transportationCharge)}</strong>.
        </p>
        <p>TAKI adds its service fee (and a handling fee when the customer asks for special handling) on top for the customer.</p>
      </>
    ),
  },
  {
    id: "capacity",
    question: "How does capacity work?",
    answer: (
      <>
        <p>
          Each trip has a maximum capacity (up to the vehicle&apos;s payload) and the capacity you offer for booking. Customers only see your
          trip if their load fits in the space that&apos;s left and their goods are accepted.
        </p>
        <p>
          Accepting a request reserves its weight while the customer pays. If the customer doesn&apos;t pay in time the space is released
          automatically. You can&apos;t accept a request that would overbook the trip.
        </p>
      </>
    ),
  },
  {
    id: "requests",
    question: "How do I accept or reject booking requests?",
    answer: (
      <>
        <p>
          New requests wait under Bookings → Pending. Each shows the customer, the part of your route they need, the weight, goods and
          what you&apos;ll earn.
        </p>
        <p>
          Accept to reserve the space; the customer is then asked to pay. Once they pay, the booking is confirmed and the customer and
          receiver details are shared with your driver. Reject with a reason if it doesn&apos;t suit you; the customer is notified.
        </p>
      </>
    ),
  },
  {
    id: "drivers",
    question: "How do I add drivers?",
    answer: (
      <p>
        Invite a driver by phone number from Drivers → Add driver; they sign up with that number and join your agency. Drivers who sign up
        on their own and choose your agency appear under Pending requests for you to approve. Only approved drivers can be assigned to
        trips, and a driver or vehicle can&apos;t be on two trips at the same time.
      </p>
    ),
  },
  {
    id: "payouts",
    question: "When do I get paid?",
    answer: (
      <p>
        Earnings are recorded when your driver confirms delivery. TAKI settles delivered bookings to your bank account periodically;
        Earnings shows what is pending and what has been settled.
      </p>
    ),
  },
  {
    id: "routes",
    question: "Can I change or cancel a trip?",
    answer: (
      <p>
        Drafts can be edited freely. On a published trip you can change rates and offered capacity, or reassign the driver. To change the
        route or times, unpublish it first (only possible before anyone has booked). Cancelling a trip with bookings notifies the
        customers and refunds paid bookings.
      </p>
    ),
  },
];

/** Agency Help (`/agency/help`): FAQ accordion with native <details>, contact and quick links. */
export function HelpView() {
  return (
    <div className="mx-auto w-full max-w-[860px]">
      <PageHeader title="Help" subtitle="Answers to common questions about running your agency on TAKI." />

      <section aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="type-h3 mb-3 text-ink">
          Frequently asked questions
        </h2>
        <div className="flex flex-col gap-3">
          {FAQS.map((faq, i) => (
            <details
              key={faq.id}
              id={`faq-${faq.id}`}
              open={i === 0}
              className="group rounded-lg border border-border bg-surface shadow-card open:border-green-200"
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 font-heading text-base font-semibold text-ink sm:px-5 [&::-webkit-details-marker]:hidden">
                {faq.question}
                <ChevronDown
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <div className="flex flex-col gap-3 px-4 pb-5 text-[15px] leading-relaxed text-ink-muted sm:px-5">{faq.answer}</div>
            </details>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card as="section" aria-labelledby="help-actions-heading" padding="md" className="flex flex-col gap-3">
          <h2 id="help-actions-heading" className="type-h3 text-ink">
            Get going
          </h2>
          <p className="text-sm text-ink-muted">Post your next trip or answer customers who are waiting on you.</p>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row md:flex-col lg:flex-row">
            <ButtonLink href={paths.agency.newTrip()} leadingIcon={<Plus aria-hidden="true" strokeWidth={2.25} />}>
              Add Trip
            </ButtonLink>
            <ButtonLink href={paths.agency.bookings()} variant="outline" leadingIcon={<ClipboardList aria-hidden="true" strokeWidth={1.75} />}>
              Bookings
            </ButtonLink>
          </div>
        </Card>

        <Card as="section" aria-labelledby="help-contact-heading" padding="md" className="flex flex-col gap-3">
          <h2 id="help-contact-heading" className="type-h3 text-ink">
            Still need help?
          </h2>
          <p className="text-sm text-ink-muted">Write to us and we&apos;ll get back to you.</p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-sm font-semibold text-green-700 underline-offset-4 hover:underline"
          >
            <Mail aria-hidden="true" strokeWidth={1.75} className="size-5" />
            {CONTACT_EMAIL}
          </a>
        </Card>
      </div>
    </div>
  );
}
