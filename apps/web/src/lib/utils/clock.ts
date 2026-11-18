/**
 * Single source of "now" for the app. Tests control time via Playwright's
 * page.clock (which patches Date), so no custom override is needed.
 */
export function getNow(): Date {
  return new Date();
}
