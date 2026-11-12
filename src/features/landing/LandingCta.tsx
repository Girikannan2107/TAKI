"use client";

import { ButtonLink, type ButtonLinkProps } from "@/components/ui";
import { paths } from "@/lib/config/routes";
import { useSession } from "@/lib/store/selectors";

export type LandingCtaIntent = "ship" | "route";

/**
 * Session-aware landing CTA (route-contract §`/`).
 * - "ship":  customer dashboard search (open to guests — login is asked only when requesting a booking);
 *            a signed-in driver → /signup?role=customer.
 * - "route": signed-out → /signup?role=driver;   signed-in driver → new route.
 * Before hydration `useSession()` reports no role, so SSR always renders the signed-out links.
 */
export function useLandingCtaHref(intent: LandingCtaIntent): string {
  const { hydrated, role } = useSession();
  if (intent === "ship") return hydrated && role === "driver" ? paths.signup("customer") : paths.customer.dashboard;
  return hydrated && role === "driver" ? paths.driver.newRoute : paths.signup("driver");
}

export type LandingCtaProps = Omit<ButtonLinkProps, "href"> & { intent: LandingCtaIntent };

export function LandingCta({ intent, ...rest }: LandingCtaProps) {
  const href = useLandingCtaHref(intent);
  return <ButtonLink href={href} {...rest} />;
}
