import type { Metadata } from "next";

/** Hidden staff area: never indexed, no public links. */
export const metadata: Metadata = {
  title: { template: "%s · TAKI admin", default: "TAKI admin" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
