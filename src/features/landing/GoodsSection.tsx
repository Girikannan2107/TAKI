import Image from "next/image";
import { CARGO_TILES } from "./content";
import { SectionHeading } from "./SectionHeading";

/** Supported goods (P3 §5 #6): the cargo categories the marketplace carries, with images. */
export function GoodsSection() {
  return (
    <section id="goods" aria-labelledby="goods-title" className="mx-auto w-full max-w-[1264px] px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
      <SectionHeading id="goods-title" eyebrow="Supported goods" title="What you can ship">
        <p>Part loads of everyday cargo, from farm produce to building supplies. Each trip lists the goods it accepts.</p>
      </SectionHeading>
      <ul className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:mt-12 lg:grid-cols-4 lg:gap-6">
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
    </section>
  );
}
