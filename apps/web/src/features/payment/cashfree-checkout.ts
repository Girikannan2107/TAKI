"use client";

/**
 * Opens Cashfree Checkout for a server-created order with the official `@cashfreepayments/cashfree-js`
 * loader (`load({ mode })` + `checkout({ paymentSessionId })`). The `mode` (sandbox / production) comes from
 * the order response, never from a browser env var. The browser never marks a payment paid: Cashfree
 * redirects to `/customer/payment/return?paymentId=…`, which asks the API to verify with Cashfree (E44).
 *
 * The package injects sdk.cashfree.com when it is imported, so it is imported lazily, only when paying.
 */
export async function openCashfreeCheckout(mode: "sandbox" | "production", paymentSessionId: string): Promise<void> {
  let cashfree;
  try {
    const { load } = await import("@cashfreepayments/cashfree-js");
    cashfree = await load({ mode });
  } catch {
    cashfree = null;
  }
  if (!cashfree) throw new Error("The payment page couldn't load. Check your connection and try again.");
  const r = await cashfree.checkout({ paymentSessionId, redirectTarget: "_self" });
  if (r && r.error) throw new Error(r.error.message || "The payment couldn't be started. Please try again.");
}
