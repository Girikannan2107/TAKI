import { expect, type Page } from "@playwright/test";

/**
 * On a Route & Booking Details page as a signed-in customer: Request Booking → tracking page →
 * demo driver acceptance → Complete payment → payment page. Returns the booking id.
 * (Approval-required flow: the customer pays only after the driver accepts.)
 */
export async function requestAcceptAndOpenPayment(page: Page): Promise<string> {
  const id = await requestBooking(page);
  await acceptAsDemoDriver(page);
  await page.getByRole("link", { name: "Complete payment" }).click();
  await page.waitForURL(/\/customer\/payment\?bookingId=TAKI\d{6}/);
  await expect(page.getByRole("heading", { level: 1, name: "Payment" })).toBeVisible();
  return id;
}

/** Clicks Request Booking and waits for the tracking page. Returns the booking id. */
export async function requestBooking(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Request Booking", exact: true }).click();
  await page.waitForURL(/\/customer\/tracking\/TAKI\d{6}/);
  await expect(page.getByTestId("tracking-status")).toContainText("Awaiting driver confirmation");
  return decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
}

/** On the tracking page of a pending request: the labelled demo control accepts as the driver. */
export async function acceptAsDemoDriver(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Demo: simulate driver acceptance" }).click();
  await expect(page.getByTestId("tracking-status")).toContainText("Accepted · Payment pending");
}
