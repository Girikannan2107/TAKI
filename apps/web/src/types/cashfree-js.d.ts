/** Minimal types for @cashfreepayments/cashfree-js (the package ships none). */
declare module "@cashfreepayments/cashfree-js" {
  export interface CashfreeCheckoutResult {
    error?: { message?: string; code?: string };
    redirect?: boolean;
    paymentDetails?: { paymentMessage?: string };
  }
  export interface Cashfree {
    checkout(opts: { paymentSessionId: string; redirectTarget?: "_self" | "_blank" | "_top" | "_modal" | HTMLElement }): Promise<CashfreeCheckoutResult>;
  }
  export function load(opts: { mode: "sandbox" | "production" }): Promise<Cashfree | null>;
}
