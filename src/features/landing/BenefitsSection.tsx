import Image from "next/image";
import { Card } from "@/components/ui";
import { BENEFITS, CARGO_TILES } from "./content";
import { SectionHeading } from "./SectionHeading";

/** "Why TAKI" benefits grid + the kinds of cargo the marketplace carries. No statistics or testimonials. */
export function BenefitsSection() {
  return (
    <section
      id="benefits"
      aria-labelledby="benefits-title"
      className="mx-auto w-full max-w-[1264px] px-4 pb-20 pt-20 sm:px-6 lg:px-8 lg:pb-24 lg:pt-28"
    >
      <SectionHeading id="benefits-title" eyebrow="Benefits" title="Why TAKI">
        <p>
          Lorries already travel between Tamil Nadu&apos;s towns with room to spare. TAKI puts that space to work: shippers pay
          for what they send, and drivers earn on trips they were making anyway.
        </p>
      </SectionHeading>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:mt-12 lg:grid-cols-3 lg:gap-6">
        {BENEFITS.map(({ icon: Icon, title, text, audience }) => (
          <Card as="li" key={title} padding="lg" className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <span className="flex size-12 items-center justify-center rounded-full bg-mint-100 text-green-700">
                <Icon aria-hidden="true" strokeWidth={1.75} className="size-6" />
              </span>
              <span className="rounded-full bg-green-50 px-3 py-1 text-caption font-medium text-green-800">{audience}</span>
            </div>
            <div>
              <h3 className="type-h3 text-ink">{title}</h3>
              <p className="mt-2 text-[15px] leading-6 text-ink-muted">{text}</p>
            </div>
          </Card>
        ))}
      </ul>

      <div className="mt-16 lg:mt-20">
        <h3 className="type-h3 text-ink">What you can ship</h3>
        <p className="mt-1 text-[15px] leading-6 text-ink-muted">Part loads of everyday cargo, from farm produce to building supplies.</p>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6">
          {CARGO_TILES.map((tile) => (
            <li key={tile.label} className="group overflow-hidden rounded-lg border border-border bg-surface shadow-card">
              <div className="relative aspect-[5/3] overflow-hidden bg-surface-muted">
                <Image
                  src={tile.src}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 290px, (min-width: 640px) 45vw, 50vw"
                  className="object-cover object-top transition-transform duration-300 motion-safe:group-hover:scale-[1.03]"
                />
              </div>
              <p className="px-3 py-3 font-heading text-sm font-semibold text-ink sm:px-4 sm:text-[15px]">{tile.label}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
