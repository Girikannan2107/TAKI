import type { LucideIcon } from "lucide-react";
import { ClipboardList, CircleHelp, House, IndianRupee, LayoutDashboard, Package, Route, UserRound, Wallet } from "lucide-react";
import { paths } from "./routes";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Item is active when the pathname starts with any of these prefixes. */
  matchPrefixes: string[];
}

export const customerNav: NavItem[] = [
  {
    label: "Home",
    href: paths.customer.dashboard,
    icon: House,
    matchPrefixes: ["/customer/dashboard", "/customer/vehicles", "/customer/booking", "/customer/payment?", "/customer/booking-confirmation"],
  },
  { label: "My Shipments", href: paths.customer.shipments, icon: Package, matchPrefixes: ["/customer/shipments", "/customer/tracking"] },
  { label: "Payments", href: paths.customer.payments, icon: Wallet, matchPrefixes: ["/customer/payments"] },
  { label: "Profile", href: paths.customer.profile, icon: UserRound, matchPrefixes: ["/customer/profile"] },
];

export const driverNav: NavItem[] = [
  { label: "Dashboard", href: paths.driver.dashboard, icon: LayoutDashboard, matchPrefixes: ["/driver/dashboard"] },
  { label: "My Routes", href: paths.driver.routes(), icon: Route, matchPrefixes: ["/driver/routes"] },
  { label: "Booking Requests", href: paths.driver.bookings(), icon: ClipboardList, matchPrefixes: ["/driver/bookings"] },
  { label: "Earnings", href: paths.driver.earnings, icon: IndianRupee, matchPrefixes: ["/driver/earnings"] },
  { label: "Profile", href: paths.driver.profile, icon: UserRound, matchPrefixes: ["/driver/profile"] },
  { label: "Help", href: paths.driver.help, icon: CircleHelp, matchPrefixes: ["/driver/help"] },
];

/** Returns true when `pathname` belongs to the nav item. "/customer/payment" (checkout) must not match "/customer/payments". */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.matchPrefixes.some((p) => {
    const prefix = p.endsWith("?") ? p.slice(0, -1) : p;
    if (p.endsWith("?")) return pathname === prefix;
    return pathname === prefix || pathname.startsWith(prefix + "/");
  });
}
