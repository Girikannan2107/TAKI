"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { paths } from "@/lib/config/routes";
import { Logo } from "@/components/brand/Logo";
import { Button, ButtonLink } from "@/components/ui/Button";

export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-12 text-center">
      <Logo variant="light" size="md" />
      <span
        aria-hidden="true"
        className="mt-10 flex size-16 items-center justify-center rounded-full bg-warning-100 text-warning-700"
      >
        <TriangleAlert strokeWidth={1.75} className="size-8" />
      </span>
      <h1 className="type-h1 mt-5 text-ink">Something went wrong</h1>
      <p className="mt-2 max-w-md text-base text-ink-muted">
        An unexpected error interrupted this page. You can try again, or head back home.
      </p>
      <div className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
        <Button size="lg" onClick={() => retry()}>
          Try again
        </Button>
        <ButtonLink href={paths.home} variant="outline" size="lg">
          Go home
        </ButtonLink>
      </div>
    </main>
  );
}
