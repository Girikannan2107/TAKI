import {
  BadgeIndianRupee,
  Building2,
  Leaf,
  Package,
  ReceiptText,
  Route,
  Search,
  Star,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { STATE_CODES, STATE_NAMES } from "@/lib/domain/model";

/** Static landing copy. Verbatim strings follow screen-inventory §01 and implementation-plan §1 #9. */

export const HERO = {
  imageSrc: "/assets/taki/hero/login_truck_mountain_photo.webp",
  imageAlt: "A green TAKI lorry driving along a winding mountain road through forested hills",
  eyebrow: "Smart Logistics Marketplace",
  titleLines: ["Your goods. Their route.", "One smart connection."],
  subtitleLines: ["Find available vehicles travelling your way.", "Ship your goods without booking an entire truck."],
} as const;

export interface LandingStep {
  icon: LucideIcon;
  title: string;
  text: string;
}

export const HOW_IT_WORKS_STEPS: LandingStep[] = [
  { icon: Search, title: "Find a Route", text: "Search for vehicles on your route." },
  { icon: Truck, title: "Choose a Vehicle", text: "Compare, check details and book." },
  // Demo honesty: no "real time" claim (implementation-plan §1 #9).
  { icon: Package, title: "Ship with Ease", text: "Pay online and track every step." },
];

export interface Benefit {
  icon: LucideIcon;
  title: string;
  text: string;
  audience: "For customers" | "For agencies" | "For everyone";
}

export const BENEFITS: Benefit[] = [
  {
    icon: BadgeIndianRupee,
    title: "Pay only for the space you use",
    text: "Book part of a lorry for your load instead of paying for an entire truck.",
    audience: "For customers",
  },
  {
    icon: ReceiptText,
    title: "Transparent pricing",
    text: "See the transport charge and the TAKI service fee before you pay. No surprises at drop-off.",
    audience: "For customers",
  },
  {
    icon: Star,
    title: "Rated by customers",
    text: "Check each driver's rating, the agency and the vehicle details before you book.",
    audience: "For customers",
  },
  {
    icon: Route,
    title: "Fill spare capacity on trips you already run",
    text: "Publish your fleet's trips with their stops and rates, and carry paying part loads along the way.",
    audience: "For agencies",
  },
  {
    icon: Building2,
    title: "Vehicles, drivers and bookings in one place",
    text: "Register vehicles, assign drivers without clashes, accept the bookings that suit you and follow every delivery.",
    audience: "For agencies",
  },
  {
    icon: Leaf,
    title: "Fewer empty kilometres",
    text: "Sharing lorries that are already on the road means less fuel burned for every load moved.",
    audience: "For everyone",
  },
];

export interface CargoTile {
  src: string;
  label: string;
}

/** Images are decorative (alt=""); the visible label names the cargo type. The source files have a label baked into the bottom ~16%, which the tile crops off (object-top, 5:3). */
export const CARGO_TILES: CargoTile[] = [
  { src: "/assets/taki/cargo/cargo_agriculture.webp", label: "Agricultural produce" },
  { src: "/assets/taki/cargo/cargo_construction.webp", label: "Construction material" },
  { src: "/assets/taki/cargo/cargo_general_goods.webp", label: "General goods" },
  { src: "/assets/taki/cargo/cargo_industrial.webp", label: "Industrial goods" },
];

export const CUSTOMER_JOURNEY = [
  "Enter your pickup, drop and load weight.",
  "Compare vehicles heading your way by price, timing and rating.",
  "Request a booking, pay once the agency accepts, and follow each update.",
];

export const AGENCY_JOURNEY = [
  "Register your vehicles and drivers.",
  "Publish trips with checkpoints and your per-km and per-kg rates.",
  "Accept bookings and track your earnings.",
];

/** States the marketplace serves (P3 §5 #9). */
export const SERVICE_STATES: string[] = STATE_CODES.map((c) => STATE_NAMES[c]);

export const ABOUT_IMAGE = {
  src: "/assets/taki/hero/hero_freight_highway_unbranded.webp",
  alt: "A white lorry on an open highway with green hills behind it",
};

/** Placeholder address only — `.example` is a reserved, non-deliverable domain. */
export const CONTACT_EMAIL = "hello@taki.example";
