import { FlaskConical, Mail, MapPin } from "lucide-react";
import { Card } from "@/components/ui";
import { CONTACT_EMAIL } from "./content";
import { ContactForm } from "./ContactForm";
import { SectionHeading } from "./SectionHeading";

/** Contact: placeholder details (no real numbers or addresses) + the demo form. */
export function ContactSection() {
  return (
    <section id="contact" aria-labelledby="contact-title" className="mx-auto w-full max-w-[1264px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
        <div>
          <SectionHeading id="contact-title" eyebrow="Contact" title="Questions about shipping or listing a route?">
            <p>Tell us what you need to move, or which routes you drive. We&apos;d like to hear from you.</p>
          </SectionHeading>
          <ul className="mt-8 flex flex-col gap-3">
            <li>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="group flex min-h-11 items-center gap-3 rounded-md text-ink transition-colors hover:text-green-700"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-700">
                  <Mail aria-hidden="true" strokeWidth={1.75} className="size-5" />
                </span>
                <span>
                  <span className="block text-sm text-ink-muted">Email</span>
                  <span className="font-medium underline-offset-4 group-hover:underline">{CONTACT_EMAIL}</span>
                </span>
              </a>
            </li>
            <li className="flex min-h-11 items-center gap-3 text-ink">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-700">
                <MapPin aria-hidden="true" strokeWidth={1.75} className="size-5" />
              </span>
              <span>
                <span className="block text-sm text-ink-muted">Service area</span>
                <span className="font-medium">Tamil Nadu, India</span>
              </span>
            </li>
          </ul>
          <p className="mt-8 flex max-w-md items-start gap-2.5 rounded-lg bg-warning-100 px-4 py-3 text-sm leading-6 text-warning-700">
            <FlaskConical aria-hidden="true" strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
            <span>This is a demo site. The email address is a placeholder and there is no phone line yet.</span>
          </p>
        </div>

        <Card padding="lg" className="rounded-xl">
          <ContactForm />
        </Card>
      </div>
    </section>
  );
}
