import type { ReactNode } from "react";
import { ChevronDown, ClipboardList, Mail, Plus } from "lucide-react";
import { ButtonLink, Card } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { paths } from "@/lib/config/routes";
import { PRICING_PREVIEW_WEIGHT_KG, SERVICE_FEE_SLABS } from "@/lib/domain/constants";
import { quote } from "@/lib/domain/pricing";
import { formatINR, formatKg, formatKm, formatRate } from "@/lib/format";

const CONTACT_EMAIL = "hello@taki.example";

// Worked example computed with the real pricing maths (498 km, ₹12/km, ₹0.50/kg, 500 kg).
const EXAMPLE = { distanceKm: 498, weightKg: PRICING_PREVIEW_WEIGHT_KG, ratePerKmPaise: 1200, ratePerKgPaise: 50 };
const EXAMPLE_QUOTE = quote(EXAMPLE);
const FIRST_SLAB = SERVICE_FEE_SLABS[0]!;

interface Faq {
  id: string;
  question: string;
  answer: ReactNode;
}

const FAQS: Faq[] = [
  {
    id: "pricing",
    question: "How is my price calculated?",
    answer: (
      <>
        <p>
          You set two rates for each route: a per-kilometre rate and a per-kilogram rate. For every booking, your earnings are the
          distance the customer&apos;s goods travel multiplied by your per-km rate, plus the weight multiplied by your per-kg rate.
        </p>
        <p>
          Example: {formatKm(EXAMPLE.distanceKm)} × {formatRate(EXAMPLE.ratePerKmPaise)} = {formatINR(EXAMPLE_QUOTE.distanceCharge)}, plus{" "}
          {formatKg(EXAMPLE.weightKg)} × {formatRate(EXAMPLE.ratePerKgPaise)} = {formatINR(EXAMPLE_QUOTE.weightCharge)}. You earn{" "}
          <strong className="font-semibold text-ink">{formatINR(EXAMPLE_QUOTE.transportationCharge)}</strong>.
        </p>
        <p>
          TAKI adds a small service fee on top for the customer (for example {formatINR(FIRST_SLAB.fee)} for loads up to{" "}
          {formatKg(FIRST_SLAB.upToKg)}). It is never taken out of your earnings.
        </p>
      </>
    ),
  },
  {
    id: "capacity",
    question: "How does capacity work?",
    answer: (
      <>
        <p>
          When you post a route you enter the vehicle&apos;s total capacity and how much of it is available for customers. Customers only
          see your route if their load fits in the space that&apos;s left.
        </p>
        <p>
          Space is only used when you accept a request: accepting deducts the booking&apos;s weight from your available capacity. Pending
          and declined requests don&apos;t hold any space, and you can&apos;t accept a request that would overbook the route.
        </p>
      </>
    ),
  },
  {
    id: "requests",
    question: "How do I accept or decline booking requests?",
    answer: (
      <>
        <p>
          Customers pay when they book, and the booking then waits for you in Booking Requests. Each request shows the customer, the
          part of your route they need, the weight and what you&apos;ll earn.
        </p>
        <p>
          Accept to confirm the booking — the customer is notified and the space is reserved. Decline if it doesn&apos;t suit you; the
          customer is refunded and your capacity doesn&apos;t change. Requests still pending when your route departs are declined
          automatically.
        </p>
      </>
    ),
  },
  {
    id: "payouts",
    question: "When do I get paid?",
    answer: (
      <>
        <p>
          When you mark a delivery as delivered, your earnings for that booking are credited to your TAKI balance and shown as
          &ldquo;Paid&rdquo; in Earnings. You can then withdraw your available balance to your bank account.
        </p>
        <p>
          This is a demo: withdrawals are simulated and no money moves. Payment and payout providers will be connected in the live
          version.
        </p>
      </>
    ),
  },
  {
    id: "routes",
    question: "Can I change or cancel a route?",
    answer: (
      <p>
        Each vehicle can have one published route per day. If your plans change before anyone has booked, contact us and we&apos;ll help.
        Cancelling a route that already has accepted bookings isn&apos;t supported in this demo.
      </p>
    ),
  },
];

/** Driver Help (`/driver/help`): FAQ accordion with native <details>, contact and quick links. */
export function HelpView() {
  return (
    <div className="mx-auto w-full max-w-[860px]">
      <PageHeader title="Help" subtitle="Answers to common questions about listing routes on TAKI." />

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
            <ButtonLink href={paths.driver.newRoute} leadingIcon={<Plus aria-hidden="true" strokeWidth={2.25} />}>
              Post a New Route
            </ButtonLink>
            <ButtonLink href={paths.driver.bookings()} variant="outline" leadingIcon={<ClipboardList aria-hidden="true" strokeWidth={1.75} />}>
              Booking Requests
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
