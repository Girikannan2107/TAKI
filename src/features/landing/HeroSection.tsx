import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { HERO } from "./content";
import { LandingCta } from "./LandingCta";

/**
 * Landing hero (board crop 01). Server component; only the CTAs are client islands.
 * - < md: photo fills the top of the hero (truck visible), text sits on the dark fade below it.
 * - ≥ md: photo is anchored right at its natural aspect ratio so the truck stays on the right,
 *   with the forest-green gradient from the left behind the text.
 * The fixed overlay SiteHeader sits on top, so content is padded by --header-height.
 */
export function HeroSection() {
  return (
    <section
      aria-labelledby="hero-title"
      data-surface="dark"
      className="relative isolate overflow-hidden bg-green-950 text-white lg:mx-4 lg:mt-4 lg:rounded-xl"
    >
      {/* Photo */}
      <div
        className={[
          "absolute inset-x-0 top-0 -z-10 h-[440px] sm:h-[500px]",
          "md:inset-y-0 md:right-auto md:left-[12%] md:h-full md:w-auto md:min-w-[88%] md:aspect-[1672/941]",
          "xl:left-[22%] xl:min-w-[78%] 2xl:left-[28%] 2xl:min-w-[72%]",
        ].join(" ")}
      >
        <Image
          src={HERO.imageSrc}
          alt={HERO.imageAlt}
          fill
          preload
          // The photo is height-driven (object-cover in a box whose width tracks the hero's height), so it renders
          // wider than its box: < 640 ≈ 440px tall → ~782px; 640–767 ≈ 500px tall → ~889px; ≥ 768 aspect box
          // ≈ 1137–1404px (hero 640–790px tall); ≥ 1920 the min-width (72–78% of the hero) wins → < 75vw.
          sizes="(min-width: 1920px) 75vw, (min-width: 768px) 1440px, (min-width: 640px) 890px, 790px"
          className="object-cover object-[62%_center] md:object-center"
        />
        {/* < md: header tint at the top, solid green at the bottom where the text starts. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-linear-to-b from-green-950/70 via-green-950/20 via-35% to-green-950 md:hidden"
        />
        {/* ≥ md: blend the photo's left edge into the green background. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 hidden w-2/5 bg-linear-to-r from-green-950 to-transparent md:block"
        />
      </div>

      {/* ≥ md overlays: brand tint, left-to-right gradient, darker sky behind the header, darker base under the card. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 hidden md:block">
        <div className="absolute inset-0 bg-green-950/15" />
        <div className="absolute inset-0 bg-grad-hero" />
        <div className="absolute inset-x-0 top-0 h-56 bg-linear-to-b from-green-950/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-linear-to-t from-green-950/60 to-transparent" />
      </div>

      <div className="mx-auto w-full max-w-[1264px] px-4 pb-24 pt-[290px] sm:px-6 sm:pt-[340px] md:min-h-[600px] md:pb-36 md:pt-[calc(var(--header-height)+64px)] lg:min-h-[704px] lg:px-8 lg:pb-44 lg:pt-[calc(var(--header-height)+80px)]">
        <div className="max-w-[44rem]">
          <p className="inline-flex items-center rounded-full bg-green-500 px-4 py-1.5 font-heading text-sm font-semibold text-white shadow-[0_4px_14px_-4px] shadow-green-950/60">
            {HERO.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="mt-5 font-heading text-[2.125rem] font-bold leading-[1.12] tracking-[-0.02em] text-white sm:text-[2.75rem] md:max-w-[32rem] lg:max-w-none lg:text-[3.25rem] lg:leading-[1.1]"
          >
            <span className="lg:block">{HERO.titleLines[0]}</span> <span className="lg:block">{HERO.titleLines[1]}</span>
          </h1>
          <p className="mt-5 max-w-[36rem] text-base leading-7 text-white/90 sm:text-lg md:max-w-[30rem] lg:max-w-[36rem]">
            <span className="lg:block">{HERO.subtitleLines[0]}</span> <span className="lg:block">{HERO.subtitleLines[1]}</span>
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
            <LandingCta
              intent="ship"
              variant="accent"
              size="lg"
              trailingIcon={<ArrowRight className="size-5" strokeWidth={2} />}
              className="w-full shadow-[0_8px_24px_-8px] shadow-lime-300/40 sm:w-auto sm:min-w-[13.5rem]"
            >
              Ship Goods
            </LandingCta>
            <LandingCta intent="route" variant="ghost-dark" size="lg" className="w-full sm:w-auto sm:min-w-[13.5rem]">
              List a Route
            </LandingCta>
          </div>
        </div>
      </div>
    </section>
  );
}
