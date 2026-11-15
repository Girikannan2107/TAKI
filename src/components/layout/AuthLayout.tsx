import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { WaveDecoration } from "@/components/brand/WaveDecoration";
import { AuthCardHeader } from "./AuthCardHeader";
import { AuthHeader } from "./AuthHeader";

export interface AuthLayoutProps {
  children: ReactNode;
  backHref?: string;
  /** Optional: render the AuthCardHeader here instead of in the page. */
  title?: string;
  subtitle?: ReactNode;
  /** default = 480px card; wide = 560px (agency signup details). */
  size?: "default" | "wide";
}

/**
 * TAKI top bar (logo + Log in / Create account) over a warm page with a centred white card
 * (480px; 560px for wide signup forms) and layered green waves along the card bottom.
 */
export function AuthLayout({ children, backHref, title, subtitle, size = "default" }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <AuthHeader />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 items-start justify-center px-4 py-6 outline-none sm:items-center sm:px-6 sm:py-10"
      >
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-auth",
            // A page inside the shared (auth) layout can opt in by rendering any element with `data-auth-wide`.
            size === "wide" ? "max-w-[560px]" : "max-w-[480px] has-[[data-auth-wide]]:max-w-[560px]",
          )}
        >
          <div className="px-5 pb-6 pt-6 sm:px-9 sm:pt-8">
            {title ? <AuthCardHeader title={title} subtitle={subtitle} backHref={backHref} /> : null}
            {children}
          </div>
          <WaveDecoration className="-mt-2" />
        </div>
      </main>
    </div>
  );
}
