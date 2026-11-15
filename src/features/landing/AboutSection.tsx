import Image from "next/image";
import { MapPin } from "lucide-react";
import { ABOUT_IMAGE, SERVICE_STATES } from "./content";
import { SectionHeading } from "./SectionHeading";

/** About TAKI: mission, South India service area and the "Travel and Agriculture" brand note. No invented statistics. */
export function AboutSection() {
  return (
    <section id="about" aria-labelledby="about-title" className="border-y border-border bg-surface">
      <div className="mx-auto grid w-full max-w-[1264px] items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-28">
        <div>
          <SectionHeading id="about-title" eyebrow="About TAKI" title="Goods ride along on routes already travelled">
            <p>
              Every day, lorries leave for the next town with part of their load space empty, while small businesses and farmers
              pay for a whole truck to move a few hundred kilos. TAKI connects the two: shippers find a vehicle already heading
              their way, and travel agencies fill the space their trips already have.
            </p>
            <p className="mt-4">
              We serve five southern states, on the routes that link their farms, markets and industrial towns. The name carries
              our brand line, <span className="font-medium text-ink">Travel and Agriculture</span>: moving produce and everyday
              goods between the places that grow and make them.
            </p>
          </SectionHeading>

          <h3 className="mt-8 flex items-center gap-2 font-heading text-sm font-semibold text-ink">
            <MapPin aria-hidden="true" strokeWidth={1.75} className="size-4 text-green-500" />
            Where we operate
          </h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {SERVICE_STATES.map((state) => (
              <li key={state} className="rounded-full border border-border bg-canvas px-3 py-1.5 text-sm text-ink-muted">
                {state}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-muted shadow-raised lg:aspect-[5/4]">
          <Image
            src={ABOUT_IMAGE.src}
            alt={ABOUT_IMAGE.alt}
            fill
            sizes="(min-width: 1024px) 600px, 100vw"
            className="object-cover object-[35%_center]"
          />
        </div>
      </div>
    </section>
  );
}
