"use client";

import { ButtonLink, type ButtonLinkProps } from "@/components/ui";
import { useShellSession } from "@/components/layout/useShellSession";
import { paths } from "@/lib/config/routes";

export type LandingCtaIntent = "ship" | "route";

/**
 * Session-aware landing CTA (P3 §5 #3).
 * - "ship":  the customer search (open to guests — login is asked only when requesting a booking);
 *            a signed-in agency / driver / admin → customer signup (one phone = one role).
 * - "route": an agency lists trips → Add Trip; everyone else → agency signup.
 * Until the session has loaded (and during SSR) the signed-out links render.
 */
export function useLandingCtaHref(intent: LandingCtaIntent): string {
  const { ready, role } = useShellSession();
  const r = ready ? role : null;
  if (intent === "ship") return r && r !== "customer" ? paths.signup("customer") : paths.customer.dashboard;
  return r === "agency" ? paths.agency.newTrip() : paths.signup("agency");
}

export type LandingCtaProps = Omit<ButtonLinkProps, "href"> & { intent: LandingCtaIntent };

export function LandingCta({ intent, ...rest }: LandingCtaProps) {
  const href = useLandingCtaHref(intent);
  return <ButtonLink href={href} {...rest} />;
}
