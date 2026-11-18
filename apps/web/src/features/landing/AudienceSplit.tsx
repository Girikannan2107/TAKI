import Link from "next/link";
import { ArrowRight, Building2, Package, type LucideIcon } from "lucide-react";
import { paths } from "@/lib/config/routes";
import { cn } from "@/lib/utils/cn";
import { AGENCY_JOURNEY, CUSTOMER_JOURNEY } from "./content";
import { LandingCta, type LandingCtaIntent } from "./LandingCta";
import { SectionHeading } from "./SectionHeading";

interface AudienceCardProps {
  dark?: boolean;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  steps: string[];
  intent: LandingCtaIntent;
  cta: string;
}

function AudienceCard({ dark, icon: Icon, eyebrow, title, steps, intent, cta }: AudienceCardProps) {
  return (
    <article
      data-surface={dark ? "dark" : undefined}
      className={cn(
        "flex flex-col rounded-xl p-6 sm:p-8 lg:p-10",
        dark ? "bg-green-950 bg-grad-sidebar text-white shadow-raised" : "border border-border bg-surface shadow-card",
      )}
    >
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full",
          dark ? "bg-white/10 text-lime-300" : "bg-mint-100 text-green-700",
        )}
      >
        <Icon aria-hidden="true" strokeWidth={1.75} className="size-7" />
      </span>
      <p
        className={cn(
          "mt-6 font-heading text-sm font-semibold uppercase tracking-[0.14em]",
          dark ? "text-lime-300" : "text-green-700",
        )}
      >
        {eyebrow}
      </p>
      <h3 className={cn("mt-2 font-heading text-[1.375rem] font-bold leading-tight sm:text-2xl", dark ? "text-white" : "text-ink")}>
        {title}
      </h3>
      <ol className="mt-6 flex flex-1 flex-col gap-4">
        {steps.map((step, i) => (
          <li key={step} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full font-heading text-sm font-bold tabular-nums",
                dark ? "bg-lime-300 text-green-950" : "bg-green-700 text-white",
              )}
            >
              {i + 1}
            </span>
            <span className={cn("pt-0.5 text-[15px] leading-6", dark ? "text-white/90" : "text-ink-muted")}>{step}</span>
          </li>
        ))}
      </ol>
      <LandingCta
        intent={intent}
        variant={dark ? "lime" : "accent"}
        size="lg"
        trailingIcon={<ArrowRight className="size-5" strokeWidth={2} />}
        className="mt-8 w-full sm:w-auto sm:self-start"
      >
        {cta}
      </LandingCta>
    </article>
  );
}

/** "For customers / For travel agencies" split with session-aware CTAs, plus the driver sign-up link. */
export function AudienceSplit() {
  return (
    <section aria-labelledby="audience-title" className="mx-auto w-full max-w-[1264px] px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
      <SectionHeading id="audience-title" eyebrow="Get started" title="One marketplace, two ways to use it" />
      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:mt-12 lg:gap-6">
        <AudienceCard
          icon={Package}
          eyebrow="For customers"
          title="Ship goods without hiring a whole truck"
          steps={CUSTOMER_JOURNEY}
          intent="ship"
          cta="Ship Goods"
        />
        <AudienceCard
          dark
          icon={Building2}
          eyebrow="For travel agencies"
          title="Turn your fleet's spare capacity into earnings"
          steps={AGENCY_JOURNEY}
          intent="route"
          cta="List a Route"
        />
      </div>
      <p className="mt-6 text-center text-[15px] text-ink-muted">
        Driving for an agency?{" "}
        <Link href={paths.signup("driver")} className="inline-flex min-h-11 items-center font-semibold text-green-700 underline underline-offset-4 hover:text-green-800">
          Sign up as a driver
        </Link>
      </p>
    </section>
  );
}
