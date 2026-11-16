import Link from "next/link";
import { paths } from "@/lib/config/routes";
import { cn } from "@/lib/utils/cn";
import { Logo } from "@/components/brand/Logo";
import type { NavLink } from "./MobileNavDrawer";
import { defaultSiteLinks } from "./SiteHeader";

const SERVICE_AREA = "Tamil Nadu, Kerala, Karnataka, Telangana and Andhra Pradesh";

export interface SiteFooterProps {
  links?: NavLink[];
  className?: string;
}

/** Header sections + the Supported goods section (footer only, keeps the header at 4 links). */
const footerLinks: NavLink[] = [...defaultSiteLinks.slice(0, 2), { label: "Supported goods", href: paths.section("goods") }, ...defaultSiteLinks.slice(2)];

const GET_STARTED: NavLink[] = [
  { label: "Ship goods", href: paths.signup("customer") },
  { label: "Register your agency", href: paths.signup("agency") },
  { label: "Driver sign-up", href: paths.signup("driver") },
  { label: "Log in", href: paths.login() },
];

const LEGAL: NavLink[] = [
  { label: "Terms of Service", href: paths.legal.terms },
  { label: "Privacy Policy", href: paths.legal.privacy },
  { label: "Refund & Cancellation", href: paths.legal.refund },
  { label: "Shipping & Delivery", href: paths.legal.shipping },
  { label: "Contact us", href: paths.section("contact") },
];

/** Simple brand footer on forest green: logo + tagline, nav, account links, copyright and image note. */
export function SiteFooter({ links = footerLinks, className }: SiteFooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer data-surface="dark" className={cn("bg-brand-primary text-white", className)}>
      <div className="mx-auto grid w-full max-w-[1264px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8 lg:py-16">
        <div className="max-w-sm">
          <Logo variant="dark" size="md" />
          <p className="mt-4 text-[15px] leading-6 text-white/90">
            A smart logistics marketplace connecting shippers with vehicles already travelling their way.
          </p>
        </div>
        <nav aria-label="Footer">
          <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-lime-300">Explore</h2>
          <ul className="mt-4 flex flex-col gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center text-[15px] text-white/90 transition-colors hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-lime-300">Get started</h2>
          <ul className="mt-4 flex flex-col gap-1">
            {GET_STARTED.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center text-[15px] text-white/90 transition-colors hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-lime-300">Legal</h2>
          <ul className="mt-4 flex flex-col gap-1">
            {LEGAL.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center text-[15px] text-white/90 transition-colors hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-[1264px] flex-col gap-1 px-4 py-5 text-[13px] text-white/90 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <p>© {year} TAKI Travel</p>
          <p>Serving {SERVICE_AREA}. Images are illustrative.</p>
        </div>
      </div>
    </footer>
  );
}
