import Link from "next/link";
import { paths } from "@/lib/config/routes";
import { Logo } from "@/components/brand/Logo";
import type { NavLink } from "./MobileNavDrawer";
import { SiteHeaderActions } from "./SiteHeaderActions";
import { SiteHeaderFrame } from "./SiteHeaderFrame";

export type { NavLink } from "./MobileNavDrawer";

export interface SiteHeaderProps {
  links?: NavLink[];
  /** overlay = fixed + transparent over the hero (turns solid on scroll); solid = sticky forest-green bar. */
  tone?: "overlay" | "solid";
}

export const defaultSiteLinks: NavLink[] = [
  { label: "How it Works", href: paths.section("how-it-works") },
  { label: "Benefits", href: paths.section("benefits") },
  { label: "About", href: paths.section("about") },
  { label: "Contact", href: paths.section("contact") },
];

/**
 * Landing header. With tone="overlay" the header is position:fixed, so the hero underneath should
 * start at the top of the page and pad its content by var(--header-height) (72px).
 */
export function SiteHeader({ links = defaultSiteLinks, tone = "overlay" }: SiteHeaderProps) {
  return (
    <SiteHeaderFrame tone={tone}>
      <div className="mx-auto flex h-full w-full max-w-[1264px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Logo variant="dark" size="md" priority />
        <nav aria-label="Primary" className="hidden md:block">
          <ul className="flex items-center gap-1 lg:gap-4">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="inline-flex h-11 items-center rounded-md px-3 font-heading text-[15px] font-semibold text-white/90 transition-colors hover:text-lime-300"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <SiteHeaderActions links={links} />
      </div>
    </SiteHeaderFrame>
  );
}
