"use client";

import Link from "next/link";
import { ArrowRight, Building2, Package, Truck, type LucideIcon } from "lucide-react";
import { AuthCardHeader } from "@/components/layout/AuthCardHeader";
import { paths, type PublicRole } from "@/lib/config/routes";
import { cn } from "@/lib/utils/cn";
import { authLinkClasses } from "./AuthBits";
import { useAuthQuery } from "./auth-query";

const ROLE_OPTIONS: ReadonlyArray<{ role: PublicRole; title: string; description: string; icon: LucideIcon }> = [
  { role: "customer", title: "I'm a Customer", description: "I want to ship goods", icon: Package },
  { role: "agency", title: "I'm a Travel Agency", description: "I run vehicles and want to fill spare capacity", icon: Building2 },
  { role: "driver", title: "I'm a Driver", description: "I drive for a registered travel agency", icon: Truck },
];

/** /signup — role selection (screen 02). Each card opens that role's details step. */
export function RoleSelectView() {
  const { role: selected, next } = useAuthQuery();

  return (
    <>
      <AuthCardHeader title="Join TAKI Travel" subtitle="Choose how you want to use TAKI" backHref={paths.home} backLabel="Back to home" />

      <ul className="flex flex-col gap-4" aria-label="Account type">
        {ROLE_OPTIONS.map(({ role, title, description, icon: Icon }) => {
          const isSelected = role === selected;
          return (
            <li key={role}>
              <Link
                href={paths.signup(role, next)}
                aria-current={isSelected ? "true" : undefined}
                data-selected={isSelected || undefined}
                className={cn(
                  "group flex min-h-[88px] w-full items-center gap-4 rounded-lg border bg-surface px-4 py-4 text-left transition-[border-color,background-color,box-shadow] duration-150 sm:px-5",
                  "hover:border-green-500 hover:bg-green-50 hover:shadow-card",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700",
                  isSelected ? "border-[1.5px] border-green-500 bg-green-50 shadow-card" : "border-border",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-14 shrink-0 items-center justify-center rounded-md bg-mint-100 text-green-700 [&_svg]:size-7"
                >
                  <Icon strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-heading text-lg font-bold leading-6 text-ink">{title}</span>
                  <span className="mt-1 block text-sm leading-5 text-ink-muted">{description}</span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-5 shrink-0 text-ink transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href={paths.login({ role: selected, next })} className={authLinkClasses}>
          Log in
        </Link>
      </p>
    </>
  );
}
