import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Building2,
  CircleHelp,
  CirclePlus,
  ClipboardList,
  History,
  House,
  IdCard,
  IndianRupee,
  LayoutDashboard,
  Package,
  PackageCheck,
  PackagePlus,
  Route,
  ShieldCheck,
  Truck,
  UserRound,
} from "lucide-react";
import { paths, type AppRole } from "./routes";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Active when the pathname equals or is under any of these. A trailing "?" means exact match only. */
  matchPrefixes: string[];
  /** Never active under these (e.g. "My Shipments" must not light up on "/customer/shipments/new"). */
  excludePrefixes?: string[];
}

/** Customer: Dashboard, New Shipment, My Shipments, Profile (P3 §2.3). */
export const customerNav: NavItem[] = [
  { label: "Dashboard", href: paths.customer.dashboard, icon: House, matchPrefixes: ["/customer/dashboard"] },
  {
    label: "New Shipment",
    href: paths.customer.newShipment(),
    icon: PackagePlus,
    matchPrefixes: ["/customer/shipments/new", "/customer/vehicles", "/customer/booking", "/customer/payment?", "/customer/booking-confirmation"],
  },
  {
    label: "My Shipments",
    href: paths.customer.shipments,
    icon: Package,
    matchPrefixes: ["/customer/shipments", "/customer/tracking", "/customer/receipt", "/customer/payments"],
    excludePrefixes: ["/customer/shipments/new"],
  },
  { label: "Profile", href: paths.customer.profile, icon: UserRound, matchPrefixes: ["/customer/profile"] },
];

/** Travel agency: 10 items (P3 §2.4). The sidebar nav scrolls on short viewports. */
export const agencyNav: NavItem[] = [
  { label: "Dashboard", href: paths.agency.dashboard, icon: LayoutDashboard, matchPrefixes: ["/agency/dashboard"] },
  { label: "Vehicles", href: paths.agency.vehicles, icon: Truck, matchPrefixes: ["/agency/vehicles"] },
  { label: "Drivers", href: paths.agency.drivers(), icon: IdCard, matchPrefixes: ["/agency/drivers"] },
  { label: "Add Trip", href: paths.agency.newTrip(), icon: CirclePlus, matchPrefixes: ["/agency/trips/new"] },
  {
    label: "Trips",
    href: paths.agency.trips(),
    icon: Route,
    matchPrefixes: ["/agency/trips"],
    excludePrefixes: ["/agency/trips/new"],
  },
  { label: "Bookings", href: paths.agency.bookings(), icon: ClipboardList, matchPrefixes: ["/agency/bookings"] },
  { label: "History", href: paths.agency.history(), icon: History, matchPrefixes: ["/agency/history"] },
  { label: "Earnings", href: paths.agency.earnings(), icon: IndianRupee, matchPrefixes: ["/agency/earnings"] },
  { label: "Profile", href: paths.agency.profile, icon: UserRound, matchPrefixes: ["/agency/profile"] },
  { label: "Help", href: paths.agency.help, icon: CircleHelp, matchPrefixes: ["/agency/help"] },
];

/** Driver app: 4 tabs (P3 §2.5). Sidebar ≥ lg, fixed bottom bar < lg. */
export const driverNav: NavItem[] = [
  { label: "Dashboard", href: paths.driver.dashboard, icon: House, matchPrefixes: ["/driver/dashboard"] },
  {
    label: "Assigned Shipments",
    href: paths.driver.shipments(),
    icon: PackageCheck,
    matchPrefixes: ["/driver/shipments", "/driver/trips"],
  },
  { label: "History", href: paths.driver.history(), icon: History, matchPrefixes: ["/driver/history"] },
  { label: "Profile", href: paths.driver.profile, icon: UserRound, matchPrefixes: ["/driver/profile"] },
];

/** Hidden admin console. */
export const adminNav: NavItem[] = [
  { label: "Overview", href: paths.admin.dashboard, icon: ShieldCheck, matchPrefixes: ["/admin?"] },
  { label: "Agencies", href: paths.admin.agencies(), icon: Building2, matchPrefixes: ["/admin/agencies"] },
  { label: "Drivers", href: paths.admin.drivers(), icon: IdCard, matchPrefixes: ["/admin/drivers"] },
  { label: "Settlements", href: paths.admin.settlements, icon: Banknote, matchPrefixes: ["/admin/settlements"] },
];

/** Default nav for a role's shell. */
export function navFor(role: AppRole): NavItem[] {
  switch (role) {
    case "customer":
      return customerNav;
    case "agency":
      return agencyNav;
    case "driver":
      return driverNav;
    case "admin":
      return adminNav;
  }
}

function matches(p: string, pathname: string): boolean {
  if (p.endsWith("?")) return pathname === p.slice(0, -1);
  return pathname === p || pathname.startsWith(p + "/");
}

/** Returns true when `pathname` belongs to the nav item. "/customer/payment" (checkout) must not match "/customer/payments". */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.excludePrefixes?.some((p) => matches(p, pathname))) return false;
  return item.matchPrefixes.some((p) => matches(p, pathname));
}
