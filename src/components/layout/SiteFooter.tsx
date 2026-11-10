import Link from "next/link";
import { paths } from "@/lib/config/routes";
import { cn } from "@/lib/utils/cn";
import { Logo } from "@/components/brand/Logo";
import type { NavLink } from "./MobileNavDrawer";
import { defaultSiteLinks } from "./SiteHeader";

export interface SiteFooterProps {
  links?: NavLink[];
  className?: string;
}

/** Simple brand footer on forest green: logo + tagline, nav, account links, copyright and image note. */
export function SiteFooter({ links = defaultSiteLinks, className }: SiteFooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer data-surface="dark" className={cn("bg-brand-primary text-white", className)}>
      <div className="mx-auto grid w-full max-w-[1264px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8 lg:py-16">
        <div className="max-w-sm">
          <Logo variant="dark" size="md" />
          <p className="mt-4 text-[15px] leading-6 text-white/75">
            A smart logistics marketplace connecting shippers with vehicles already travelling their way.
          </p>
        </div>
        <nav aria-label="Footer">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-lime-300">Explore</h2>
          <ul className="mt-4 flex flex-col gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-9 items-center text-[15px] text-white/80 transition-colors hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-lime-300">Get started</h2>
          <ul className="mt-4 flex flex-col gap-1">
            <li>
              <Link href={paths.signup("customer")} className="inline-flex min-h-9 items-center text-[15px] text-white/80 transition-colors hover:text-white">
                Ship goods
              </Link>
            </li>
            <li>
              <Link href={paths.signup("driver")} className="inline-flex min-h-9 items-center text-[15px] text-white/80 transition-colors hover:text-white">
                List a route
              </Link>
            </li>
            <li>
              <Link href={paths.login()} className="inline-flex min-h-9 items-center text-[15px] text-white/80 transition-colors hover:text-white">
                Log in
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-[1264px] flex-col gap-1 px-4 py-5 text-[13px] text-white/65 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <p>© {year} TAKI Travel</p>
          <p>Images are illustrative. This is a demo — no real bookings, payments or tracking.</p>
        </div>
      </div>
    </footer>
  );
}
