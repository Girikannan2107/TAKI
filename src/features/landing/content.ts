import {
  BadgeIndianRupee,
  Leaf,
  ListChecks,
  Package,
  ReceiptText,
  Route,
  Search,
  Star,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { CITIES } from "@/lib/domain/cities";

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
  audience: "For customers" | "For drivers" | "For everyone";
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
    text: "Check each operator's rating, trip count and vehicle details before you book.",
    audience: "For customers",
  },
  {
    icon: Route,
    title: "Earn on trips you already make",
    text: "List the routes you drive and fill spare capacity with paying loads along the way.",
    audience: "For drivers",
  },
  {
    icon: ListChecks,
    title: "You stay in control",
    text: "Set your own per-km and per-kg rates, then accept only the bookings that suit you.",
    audience: "For drivers",
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
  "Compare vehicles heading your way by price and rating.",
  "Pay online and follow each status update.",
];

export const DRIVER_JOURNEY = [
  "Add your route, stops and departure time.",
  "Set your per-km and per-kg rates.",
  "Accept the requests that fit and track your earnings.",
];

/** Tamil Nadu cities from the shared city list (the demo marketplace's service area). */
export const ABOUT_CITIES = CITIES.filter((c) => c.state === "Tamil Nadu").map((c) => c.name);

export const ABOUT_IMAGE = {
  src: "/assets/taki/hero/hero_freight_highway_unbranded.webp",
  alt: "A white lorry on an open highway with green hills behind it",
};

/** Placeholder address only — `.example` is a reserved, non-deliverable domain. */
export const CONTACT_EMAIL = "hello@taki.example";
