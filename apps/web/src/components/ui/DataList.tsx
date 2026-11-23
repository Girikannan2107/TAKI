import type { Key, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface DataListColumn<Row> {
  /** Stable key for the column. */
  id: string;
  header: ReactNode;
  cell(row: Row): ReactNode;
  align?: "left" | "right" | "center";
  /** Extra classes for the th/td (e.g. "w-40"). */
  className?: string;
  /** Visually hide the header text (still announced), e.g. for an actions column. */
  hideHeader?: boolean;
}

export interface DataListProps<Row> {
  /** Accessible name of the table/list ("Booking history"). */
  label: string;
  columns: ReadonlyArray<DataListColumn<Row>>;
  rows: readonly Row[];
  rowKey(row: Row): Key;
  /** Card body for one row below md. Defaults to "header: value" pairs. */
  renderMobile?(row: Row): ReactNode;
  /** Shown instead of the table when rows is empty (e.g. an <EmptyState>). */
  empty?: ReactNode;
  /** Slot below the list, e.g. a "Load more" button. */
  footer?: ReactNode;
  /** Visible caption above the table (default: sr-only label). */
  caption?: ReactNode;
  className?: string;
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

/** Wide data that never overflows at 360px: a real <table> ≥ md, a <ul> of cards below md. */
export function DataList<Row>({ label, columns, rows, rowKey, renderMobile, empty, footer, caption, className }: DataListProps<Row>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface shadow-card md:block">
        <table className="w-full border-collapse text-sm">
          <caption className={caption ? "px-4 pt-4 text-left font-heading text-[15px] font-semibold text-ink" : "sr-only"}>
            {caption ?? label}
          </caption>
          <thead>
            <tr className="border-b border-border bg-surface-muted/60">
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn("px-4 py-3 text-caption font-semibold uppercase tracking-wide text-ink-muted", alignClass[c.align ?? "left"], c.className)}
                >
                  {c.hideHeader ? <span className="sr-only">{c.header}</span> : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="transition-colors hover:bg-surface-muted/50">
                {columns.map((c) => (
                  <td key={c.id} className={cn("px-4 py-3 align-middle text-ink", alignClass[c.align ?? "left"], c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={label} className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card">
            {renderMobile ? (
              renderMobile(row)
            ) : (
              <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                {columns.map((c) => (
                  <div key={c.id} className="contents">
                    <dt className="text-ink-muted">{c.header}</dt>
                    <dd className="min-w-0 break-words text-right text-ink">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>

      {footer ? <div className="mt-4 flex justify-center">{footer}</div> : null}
    </div>
  );
}
