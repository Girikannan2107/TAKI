import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { paths } from "@/lib/config/routes";
import { Logo } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12 text-center">
      <Logo variant="light" size="md" />
      <span
        aria-hidden="true"
        className="mt-10 flex size-16 items-center justify-center rounded-full bg-mint-100 text-green-700"
      >
        <Compass strokeWidth={1.75} className="size-8" />
      </span>
      <p className="mt-5 font-heading text-sm font-semibold uppercase tracking-[0.18em] text-green-500">Error 404</p>
      <h1 className="type-h1 mt-2 text-ink">Page not found</h1>
      <p className="mt-2 max-w-md text-base text-ink-muted">
        This route doesn&apos;t exist or may have moved. Let&apos;s get you back on the road.
      </p>
      <ButtonLink href={paths.home} size="lg" className="mt-8">
        Go home
      </ButtonLink>
    </main>
  );
}
