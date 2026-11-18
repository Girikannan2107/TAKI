import { ArrowRight } from "lucide-react";
import { HOW_IT_WORKS_STEPS } from "./content";

/** White "How TAKI Works" card overlapping the bottom of the hero (board crop 01). */
export function HowItWorksCard() {
  const last = HOW_IT_WORKS_STEPS.length - 1;
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="relative z-10 mx-auto -mt-14 w-full max-w-[1264px] px-4 sm:px-6 md:-mt-20 lg:-mt-28 lg:px-8"
    >
      <div className="rounded-xl border border-border bg-surface px-5 py-7 shadow-raised sm:px-8 md:py-9 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-center lg:gap-12 lg:px-12 lg:py-11">
        <h2
          id="how-it-works-title"
          className="font-heading text-2xl font-bold leading-tight text-ink md:text-[1.75rem] lg:text-[2rem] lg:leading-[1.2]"
        >
          How TAKI<span className="lg:block"> Works</span>
        </h2>
        <ol className="mt-6 grid gap-6 md:mt-8 md:grid-cols-3 md:gap-14 lg:mt-0">
          {HOW_IT_WORKS_STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="relative flex items-start gap-4 md:flex-col md:gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-mint-100 text-green-700 md:size-11 md:justify-start md:rounded-none md:bg-transparent">
                <Icon aria-hidden="true" strokeWidth={1.5} className="size-6 md:size-10" />
              </span>
              <div className="min-w-0">
                <h3 className="font-heading text-[1.0625rem] font-bold leading-6 text-ink lg:text-lg">{title}</h3>
                <p className="mt-1 text-[15px] leading-6 text-ink-muted">{text}</p>
              </div>
              {i < last ? (
                <ArrowRight
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="absolute -right-[38px] top-[58px] hidden size-5 text-ink-subtle md:block"
                />
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
