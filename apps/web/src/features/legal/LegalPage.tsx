import type { ReactNode } from "react";
import Link from "next/link";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { paths } from "@/lib/config/routes";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

export interface LegalPageProps {
  title: string;
  summary: string;
  sections: LegalSection[];
}

/**
 * Policy page shell (M5). The structure and the confirmed rules are real; wording marked "Owner to
 * supply" is a placeholder the owner replaces with reviewed legal text before launch.
 */
export function LegalPage({ title, summary, sections }: LegalPageProps) {
  return (
    <>
      <SiteHeader tone="solid" />
      <main id="main" className="bg-canvas">
        <article className="mx-auto w-full max-w-[860px] px-4 py-10 sm:px-6 lg:py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-green-700">Legal</p>
          <h1 className="type-h1 mt-2 text-ink">{title}</h1>
          <p className="mt-3 text-base text-ink-muted">{summary}</p>
          <p role="note" className="mt-5 rounded-md border border-warning-700/15 bg-warning-100 px-4 py-3 text-sm text-warning-700">
            Draft structure. TAKI&apos;s final policy text will be published here before launch; the rules marked as confirmed already apply.
          </p>
          <nav aria-label="On this page" className="mt-8 rounded-lg border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-ink">On this page</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-green-700 underline-offset-4 hover:underline">
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="mt-8 flex flex-col gap-8">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24">
                <h2 id={`${s.id}-title`} className="type-h3 text-ink">
                  {i + 1}. {s.title}
                </h2>
                <div className="mt-2 flex flex-col gap-2 text-[15px] leading-7 text-ink [&_ul]:list-disc [&_ul]:pl-5">{s.body}</div>
              </section>
            ))}
          </div>
          <p className="mt-10 border-t border-border pt-6 text-sm text-ink-muted">
            Questions? <Link href={paths.section("contact")} className="font-semibold text-green-700 underline-offset-4 hover:underline">Contact TAKI</Link>.
          </p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

/** Marks wording the owner still has to supply. Inline (it is also used inside paragraphs). */
export function OwnerText({ children }: { children: ReactNode }) {
  return (
    <span className="block text-ink-muted">
      <span className="font-semibold text-ink">Owner to supply:</span> {children}
    </span>
  );
}
