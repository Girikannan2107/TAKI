import type { Metadata } from "next";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AboutSection } from "@/features/landing/AboutSection";
import { AudienceSplit } from "@/features/landing/AudienceSplit";
import { BenefitsSection } from "@/features/landing/BenefitsSection";
import { ContactSection } from "@/features/landing/ContactSection";
import { GoodsSection } from "@/features/landing/GoodsSection";
import { HeroSection } from "@/features/landing/HeroSection";
import { HowItWorksCard } from "@/features/landing/HowItWorksCard";

export const metadata: Metadata = {
  title: { absolute: "TAKI Travel — Smart Logistics Marketplace" },
  description:
    "Find vehicles already travelling your way and ship goods without booking an entire truck. Travel agencies publish their trips and earn from spare capacity.",
};

/** Landing page (`/`). Server component; the CTAs, header actions and contact form are client islands. */
export default function HomePage() {
  return (
    <>
      <SiteHeader tone="overlay" />
      <main id="main">
        <HeroSection />
        <HowItWorksCard />
        <BenefitsSection />
        <GoodsSection />
        <AudienceSplit />
        <AboutSection />
        <ContactSection />
      </main>
      <SiteFooter />
    </>
  );
}
