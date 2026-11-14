"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { paths } from "@/lib/config/routes";

const LINK =
  "inline-flex h-11 items-center rounded-lg px-3.5 font-heading text-white/90 transition-colors hover:bg-white/10 hover:text-white";

/** Slim TAKI top bar for the login / sign-up pages (same primary bar as the app header). */
export function AuthHeader() {
  const pathname = usePathname() ?? "";
  const onLogin = pathname.startsWith("/auth/login");
  // The hidden admin console keeps its own sign-in; no public account links there.
  const admin = pathname.startsWith("/admin");
  return (
    <header data-surface="dark" className="bg-sage-900 text-white shadow-[0_1px_0] shadow-white/10">
      <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Logo variant="dark" size="md" href={paths.home} priority />
        {admin ? null : (
          <nav aria-label="Account" className="flex items-center gap-1 text-[15px] font-semibold">
            {onLogin ? (
              <Link href={paths.signup()} className={LINK}>
                Create account
              </Link>
            ) : (
              <Link href={paths.login()} className={LINK}>
                Log in
              </Link>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
