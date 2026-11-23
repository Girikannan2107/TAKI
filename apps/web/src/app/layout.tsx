import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import { SkipLink } from "@/components/layout/SkipLink";
import { Providers } from "./providers";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-montserrat",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s | TAKI Travel",
    default: "TAKI Travel — Smart Logistics Marketplace",
  },
  description:
    "Find vehicles already travelling your way and ship goods without booking an entire truck. Drivers list routes and earn from spare capacity.",
  applicationName: "TAKI Travel",
};

export const viewport: Viewport = {
  themeColor: "#087443",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" data-scroll-behavior="smooth" className={`${montserrat.variable} ${inter.variable}`}>
      <body className="min-h-dvh bg-canvas font-body text-ink antialiased">
        <SkipLink />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
