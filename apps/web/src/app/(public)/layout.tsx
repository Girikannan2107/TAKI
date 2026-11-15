/** Public pages compose their own SiteHeader (so it can overlay the hero) and SiteFooter. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return children;
}
