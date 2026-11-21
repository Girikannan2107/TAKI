/**
 * T1 Playwright fixtures: page health watcher (console errors + failed requests), UI login, layout and axe checks,
 * screenshots under test-results/visual.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import type { Account } from "./e2e-api";

export { expect };

export const VISUAL_DIR = path.join(__dirname, "..", "..", "test-results", "visual");

type Issue = { kind: "console" | "pageerror" | "response" | "requestfailed"; text: string };

export class Watch {
  issues: Issue[] = [];
  private allowed: RegExp[] = [
    // Next dev / HMR noise and aborted RSC prefetches on navigation.
    /_next\/webpack-hmr|__nextjs_original-stack-frame|_rsc=|net::ERR_ABORTED/,
    // Firebase Auth emulator banner/warnings.
    /Firebase Auth emulator|emulator/i,
    // Firebase JS SDK asks the Auth emulator for a reCAPTCHA Enterprise config; the emulator answers 501.
    /recaptchaConfig/,
  ];
  enabled = true;
  allow(...patterns: RegExp[]) {
    this.allowed.push(...patterns);
  }
  attach(page: Page) {
    page.on("console", (m) => {
      if (m.type() === "error") this.push({ kind: "console", text: `${m.text()} @ ${m.location().url}` });
    });
    page.on("pageerror", (e) => this.push({ kind: "pageerror", text: String(e) }));
    page.on("response", (r) => {
      if (r.status() >= 400) this.push({ kind: "response", text: `${r.status()} ${r.request().method()} ${r.url()}` });
    });
    page.on("requestfailed", (r) => this.push({ kind: "requestfailed", text: `${r.failure()?.errorText} ${r.method()} ${r.url()}` }));
  }
  private push(i: Issue) {
    if (!this.allowed.some((re) => re.test(i.text))) this.issues.push(i);
  }
  /** Issues not matched by the allow list (allow list checked again at read time). */
  unexpected(): Issue[] {
    return this.issues.filter((i) => !this.allowed.some((re) => re.test(i.text)));
  }
}

export const test = base.extend<{ watch: Watch }>({
  watch: [
    async ({ page }, use, info) => {
      const w = new Watch();
      w.attach(page);
      await use(w);
      const bad = w.unexpected();
      if (bad.length) await info.attach("page-issues.json", { body: JSON.stringify(bad, null, 2), contentType: "application/json" });
      if (w.enabled && info.status === info.expectedStatus) {
        expect.soft(bad, `console errors / failed requests on ${info.title}`).toEqual([]);
      }
    },
    { auto: true },
  ],
});

/** Log in through the real UI (phone + password → custom token → Firebase session in IndexedDB). */
export async function loginUI(page: Page, acct: Account, opts: { next?: string; expectPath?: RegExp } = {}) {
  if (acct.role === "admin") {
    await page.goto(`/admin/login${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`);
  } else {
    await page.goto(`/auth/login?role=${acct.role}${opts.next ? `&next=${encodeURIComponent(opts.next)}` : ""}`);
  }
  await page.getByLabel("Mobile number").fill(acct.mobile);
  await page.getByLabel("Password", { exact: true }).fill(acct.password);
  await page.getByRole("button", { name: acct.role === "admin" ? /^sign in$/i : /^log in$/i }).click();
  // Never accept the login page itself (/admin/login matches "/admin/").
  await expect(page).toHaveURL(opts.expectPath ?? new RegExp(`/${acct.role}(\\?|$|/(?!login))`), { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/(admin|auth)\/login/);
}

export async function expectNoHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(sw, `horizontal scroll: scrollWidth ${sw} > innerWidth ${iw}`).toBeLessThanOrEqual(iw);
}

export type AxeFinding = { id: string; impact: string; help: string; nodes: string[] };

export async function axeSeriousCritical(page: Page): Promise<AxeFinding[]> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact!, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

/** Full-page screenshot to test-results/visual/<name>-<project>.png (tracked baselines). */
export async function snap(page: Page, name: string) {
  fs.mkdirSync(VISUAL_DIR, { recursive: true });
  const project = test.info().project.name;
  await page.evaluate(() => document.fonts?.ready);
  await page.screenshot({ path: path.join(VISUAL_DIR, `${name}-${project}.png`), fullPage: true, animations: "disabled", caret: "hide" });
}

export const isMobile = () => test.info().project.name === "mobile";

/** Wait for the page's data to load (no skeletons with aria-busy left). */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
}
