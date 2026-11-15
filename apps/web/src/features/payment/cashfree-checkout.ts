"use client";

/**
 * Opens Cashfree Checkout (JS SDK v3) for a server-created order. The browser never marks a
 * payment paid: Cashfree redirects to `/customer/payment/return?paymentId=…`, which asks the
 * server (GET /api/payments/[id] → provider Get Order) for the real status.
 */
const SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";

interface CashfreeInstance {
  checkout(opts: { paymentSessionId: string; redirectTarget?: "_self" | "_blank" | "_top" | "_modal" }): Promise<{ error?: { message?: string } } | void>;
}
type CashfreeFactory = (opts: { mode: "sandbox" | "production" }) => CashfreeInstance;

let loading: Promise<CashfreeFactory> | null = null;

function loadSdk(): Promise<CashfreeFactory> {
  const w = window as unknown as { Cashfree?: CashfreeFactory };
  if (w.Cashfree) return Promise.resolve(w.Cashfree);
  loading ??= new Promise<CashfreeFactory>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => (w.Cashfree ? resolve(w.Cashfree) : reject(new Error("The payment page couldn't load. Please try again.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("The payment page couldn't load. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export async function openCashfreeCheckout(mode: "sandbox" | "production", paymentSessionId: string): Promise<void> {
  const factory = await loadSdk();
  const r = await factory({ mode }).checkout({ paymentSessionId, redirectTarget: "_self" });
  if (r && r.error) throw new Error(r.error.message || "The payment couldn't be started. Please try again.");
}
