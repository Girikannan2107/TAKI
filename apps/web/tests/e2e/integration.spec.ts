/**
 * T5 — integration, security and performance checks (production build on E2E_PORT).
 * Run: E2E_PORT=3100 npx playwright test tests/e2e/integration.spec.ts --project=desktop --workers=1
 * Writes machine-readable summaries to test-results/t5/*.json.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page, type Response } from "@playwright/test";

const OUT = path.join(process.cwd(), "test-results", "t5");
fs.mkdirSync(OUT, { recursive: true });
const writeJson = (name: string, data: unknown) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));

const STORE_KEY = "taki-demo-v1";
const tomorrowIst = () => new Date(Date.now() + 5.5 * 3600e3 + 864e5).toISOString().slice(0, 10);

type Role = "customer" | "driver";
const SESSIONS: Record<Role, { accountId: string; profileId: string }> = {
  customer: { accountId: "usr_arjun", profileId: "cus_arjun" },
  driver: { accountId: "usr_ravi", profileId: "drv_ravi" },
};

function stateFor(role: Role): string {
  const now = Date.now();
  const s = SESSIONS[role];
  return JSON.stringify({
    state: { session: { ...s, role, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 864e5).toISOString() } },
    version: 1,
  });
}

/** Seed a session once per tab (later navigations keep the app's own state). */
async function seedSession(page: Page, role: Role) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("t5-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("t5-seeded", "1");
      }
    },
    [STORE_KEY, stateFor(role)] as const,
  );
}

const PUBLIC_ROUTES = ["/", "/signup", "/signup?role=customer", "/auth/login", "/auth/phone?flow=signup&role=customer", "/auth/phone?flow=login"];
const customerRoutes = () => [
  "/customer",
  "/customer/dashboard",
  `/customer/vehicles?from=coimbatore&to=chennai&weight=500&date=${tomorrowIst()}`,
  "/customer/booking/rte_r1",
  "/customer/payment?bookingId=TAKI874523",
  "/customer/booking-confirmation?bookingId=TAKI874523",
  "/customer/tracking/TAKI874523",
  "/customer/shipments",
  "/customer/payments",
  "/customer/profile",
];
const DRIVER_ROUTES = [
  "/driver",
  "/driver/dashboard",
  "/driver/routes",
  "/driver/routes?status=completed",
  "/driver/routes/new",
  "/driver/routes/new/pricing",
  "/driver/bookings",
  "/driver/bookings?tab=accepted",
  "/driver/earnings",
  "/driver/profile",
  "/driver/help",
];

interface PageReport {
  url: string;
  finalUrl: string;
  status: number | null;
  notFound: boolean;
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
  badImages: string[];
  imageRequests: number;
}

/** Attach collectors to a page; returns a function that snapshots + resets them. */
function collect(page: Page, origin: string) {
  let consoleErrors: string[] = [];
  let pageErrors: string[] = [];
  let badResponses: string[] = [];
  let imageRequests = 0;
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on("response", (r: Response) => {
    const u = new URL(r.url());
    if (u.origin !== origin) return;
    const isImg = u.pathname.startsWith("/_next/image") || u.pathname.startsWith("/assets/taki/");
    if (isImg) imageRequests++;
    // Document 404s are judged by the crawler itself; everything else must be < 400.
    if (r.status() >= 400 && r.request().resourceType() !== "document") badResponses.push(`${r.status()} ${u.pathname}${u.search}`);
    if (isImg && r.status() !== 200 && r.status() !== 304) badResponses.push(`image ${r.status()} ${u.pathname}${u.search}`);
  });
  page.on("requestfailed", (r) => {
    const u = new URL(r.url());
    // Aborted RSC prefetches on navigation are normal; real asset failures are not.
    if (u.origin === origin && !/_rsc=/.test(u.search) && r.failure()?.errorText !== "net::ERR_ABORTED")
      badResponses.push(`failed ${u.pathname}: ${r.failure()?.errorText}`);
  });
  return () => {
    const snap = { consoleErrors, pageErrors, badResponses, imageRequests };
    consoleErrors = [];
    pageErrors = [];
    badResponses = [];
    imageRequests = 0;
    return snap;
  };
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  // Scroll through the page so lazy images load, then wait for them.
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.complete ? null : new Promise((r) => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); setTimeout(r, 5000); }),
      ),
    );
  });
}

async function visit(page: Page, url: string, snap: ReturnType<typeof collect>): Promise<PageReport & { links: string[] }> {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  await settle(page);
  const notFound = (await page.getByRole("heading", { level: 1, name: "Page not found" }).count()) > 0;
  const crashed = (await page.getByRole("heading", { level: 1, name: "Something went wrong" }).count()) > 0;
  const badImages = await page.evaluate(() =>
    Array.from(document.images)
      .filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => i.currentSrc || i.src),
  );
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((a) => a.href)
      .filter((h) => h.startsWith(location.origin)),
  );
  const s = snap();
  if (crashed) s.pageErrors.push("error boundary rendered (Something went wrong)");
  return { url, finalUrl: page.url().replace(new URL(page.url()).origin, ""), status: res?.status() ?? null, notFound, ...s, badImages, links };
}

function normalise(href: string, origin: string): string | null {
  const u = new URL(href);
  if (u.origin !== origin) return null;
  if (u.pathname.startsWith("/api/")) return null;
  u.hash = "";
  return u.pathname + u.search;
}

async function crawl(page: Page, seeds: string[], allowPrefix: RegExp | null) {
  const origin = new URL(page.url() === "about:blank" ? "http://localhost:3100" : page.url()).origin;
  const baseOrigin = test.info().project.use.baseURL ?? origin;
  const snap = collect(page, new URL(baseOrigin).origin);
  const seen = new Set<string>();
  const queue = [...seeds];
  const reports: PageReport[] = [];
  while (queue.length) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await visit(page, url, snap);
    const { links, ...rest } = r;
    reports.push(rest);
    for (const l of links) {
      const n = normalise(l, new URL(baseOrigin).origin);
      if (n && !seen.has(n) && (!allowPrefix || allowPrefix.test(n) || PUBLIC_ROUTES.includes(n) || n === "/")) queue.push(n);
    }
  }
  return reports;
}

function assertReports(reports: PageReport[]) {
  for (const r of reports) {
    expect.soft(r.status, `${r.url} HTTP status`).not.toBe(500);
    expect.soft(r.status === 404 || r.notFound, `${r.url} → 404 / not-found page`).toBe(false);
    expect.soft(r.pageErrors, `${r.url} uncaught page errors`).toEqual([]);
    expect.soft(r.consoleErrors, `${r.url} console errors`).toEqual([]);
    expect.soft(r.badResponses, `${r.url} failed same-origin requests`).toEqual([]);
    expect.soft(r.badImages, `${r.url} <img> with naturalWidth 0`).toEqual([]);
  }
}

test.describe("T5 crawler — every route and every same-origin link", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(420_000);

  test("public pages (logged out)", async ({ page }) => {
    const reports = await crawl(page, PUBLIC_ROUTES, /^\/(signup|auth\/)|^\/$/);
    writeJson("crawl-public.json", reports);
    expect(reports.length).toBeGreaterThanOrEqual(PUBLIC_ROUTES.length);
    assertReports(reports);
  });

  for (const role of ["customer", "driver"] as const) {
    test(`${role} pages`, async ({ page }) => {
      await seedSession(page, role);
      const seeds = role === "customer" ? customerRoutes() : DRIVER_ROUTES;
      const reports = await crawl(page, seeds, role === "customer" ? /^\/customer/ : /^\/driver/);
      writeJson(`crawl-${role}.json`, reports);
      // Never bounced to login or the other role's area.
      for (const r of reports.filter((x) => x.url.startsWith(`/${role}`)))
        expect.soft(r.finalUrl.startsWith(`/${role}`), `${r.url} stayed in /${role} (got ${r.finalUrl})`).toBe(true);
      assertReports(reports);
    });
  }

  test("unknown path renders the branded not-found page with a home link", async ({ page }) => {
    const res = await page.goto("/no-such-page-t5");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: /home/i }).first()).toBeVisible();
  });
});

test.describe("T5 guards and redirects", () => {
  test("logged out: protected pages redirect to login with a safe next", async ({ page }) => {
    // Search pages (/customer/dashboard, /vehicles, /booking/*) are public; everything after Request Booking is protected.
    for (const p of ["/customer/shipments", "/driver/earnings", "/customer/tracking/TAKI874523"]) {
      await page.goto(p);
      await page.waitForURL(/\/auth\/login\?next=/);
      expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "")).toBe(p);
    }
  });

  test("wrong role is redirected to its own dashboard", async ({ browser }) => {
    for (const [role, target, home] of [
      ["customer", "/driver/earnings", "/customer/dashboard"],
      ["driver", "/customer/payments", "/driver/dashboard"],
    ] as const) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await seedSession(page, role);
      await page.goto(target);
      await page.waitForURL((u) => u.pathname === home, { timeout: 15_000 });
      await ctx.close();
    }
  });

  for (const next of ["//evil.example", "https://evil.example", "/\\evil.example", "/driver/earnings", "javascript:alert(1)"]) {
    test(`open redirect blocked: next=${next}`, async ({ page }) => {
      await page.goto(`/auth/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel("Mobile number").fill("9876543210");
      await page.getByLabel("Password", { exact: true }).fill("Taki@2026");
      await page.getByRole("button", { name: "Log In", exact: true }).click();
      await page.waitForURL((u) => u.pathname === "/customer/dashboard", { timeout: 15_000 });
      expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL!).host);
    });
  }

  test("wrong password surfaces the DomainError message; no plaintext password stored", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Mobile number").fill("9876543210");
    await page.getByLabel("Password", { exact: true }).fill("Wrong@2025");
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    await expect(page.getByText("Mobile number or password is incorrect.")).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("Taki@2026");
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    await page.waitForURL(/\/customer\/dashboard/);
    const stored = await page.evaluate((k) => localStorage.getItem(k) ?? "", STORE_KEY);
    expect(stored).not.toContain("Taki@2026");
    expect(stored).not.toContain("Wrong@2025");
    // S-3: no card-like 13–19 digit numbers and no CVV fields.
    expect(stored.match(/(?<![\d.])\d{13,19}(?![\d.])/g) ?? []).toEqual([]);
    expect(stored.toLowerCase()).not.toContain("cvv");
  });

  test("security headers on HTML and API responses (S-11)", async ({ request }) => {
    for (const p of ["/", "/customer/dashboard"]) {
      const res = await request.get(p);
      const h = res.headers();
      expect.soft(h["x-content-type-options"], `${p} nosniff`).toBe("nosniff");
      expect.soft(h["referrer-policy"], `${p} referrer-policy`).toBeTruthy();
      expect.soft(Boolean(h["x-frame-options"]) || /frame-ancestors/.test(h["content-security-policy"] ?? ""), `${p} frame protection`).toBe(true);
      expect.soft(h["x-powered-by"], `${p} x-powered-by hidden`).toBeUndefined();
    }
  });

  test("Cashfree stubs answer 501 unconfigured; webhook never 2xx without a signature", async ({ request }) => {
    const order = await request.post("/api/payments/cashfree/order", { data: { bookingId: "TAKI874523", idempotencyKey: "pay_TAKI874523_x1", amount: 1 } });
    expect(order.status()).toBe(501);
    expect(await order.json()).toEqual({ error: "payments_not_configured" });
    for (const headers of [{}, { "x-webhook-signature": "AAAA", "x-webhook-timestamp": "1700000000" }] as Array<Record<string, string>>) {
      const wh = await request.post("/api/payments/cashfree/webhook", { data: "{}", headers });
      expect([401, 501]).toContain(wh.status());
    }
    expect((await request.get("/api/payments/cashfree/verify?orderId=abc")).status()).toBe(501);
  });
});

test.describe("T5 resilience", () => {
  test("hero image and logo asset blocked → landing still renders and stays usable", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const aborted: string[] = [];
    await page.route(/(hero|taki_symbol)/i, (route) => {
      aborted.push(route.request().url());
      return route.abort("failed");
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(aborted.length, "hero/logo requests were intercepted").toBeGreaterThan(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Ship Goods/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "TAKI Travel home" }).first()).toBeVisible();
    // Broken images keep their alt text (no layout crash, accessible fallback).
    const altless = await page.evaluate(() => Array.from(document.images).filter((i) => !i.hasAttribute("alt")).length);
    expect(altless).toBe(0);
    await page.getByRole("link", { name: /Ship Goods/ }).first().click();
    await page.waitForURL(/\/customer\/dashboard/);
    expect(errors).toEqual([]);
    writeJson("network-failure.json", { aborted });
  });

  test("a failed JS chunk on a client navigation does not white-screen the app", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.route(/\/_next\/static\/chunks\/.*\.js$/, (r) => r.abort("failed"));
    await page.getByRole("link", { name: /Ship Goods/ }).first().click();
    // Either the navigation falls back to a full page load or the current page stays intact.
    await page.waitForTimeout(3000);
    const bodyText = (await page.locator("body").innerText()).trim();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  for (const [name, value] of [
    ["unparseable JSON", "{garbage"],
    ["wrong shape", JSON.stringify({ state: { db: { nope: 1 }, session: 42 }, version: 1 })],
    ["old version", JSON.stringify({ state: { db: { accounts: {} } }, version: 0 })],
  ] as const) {
    test(`corrupt localStorage (${name}) → app recovers without crashing`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript(([k, v]) => {
        if (!sessionStorage.getItem("t5-corrupt")) {
          localStorage.setItem(k, v);
          sessionStorage.setItem("t5-corrupt", "1");
        }
      }, [STORE_KEY, value] as const);
      await page.goto("/customer/shipments");
      await page.waitForURL(/\/auth\/login/, { timeout: 15_000 });
      await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toHaveCount(0);
      // The seeded demo login still works after recovery.
      await page.getByLabel("Mobile number").fill("9876543210");
      await page.getByLabel("Password", { exact: true }).fill("Taki@2026");
      await page.getByRole("button", { name: "Log In", exact: true }).click();
      await page.waitForURL(/\/customer\/shipments/);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("T5 double submission", () => {
  test("double-click Confirm withdrawal creates exactly one demo payout", async ({ page }) => {
    await seedSession(page, "driver");
    await page.goto("/driver/earnings");
    const payouts = () =>
      page.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k) ?? "{}")?.state?.db?.payouts ?? {}).length, STORE_KEY);
    await expect(page.getByRole("button", { name: "Withdraw" })).toBeEnabled();
    const before = await payouts();
    await page.getByRole("button", { name: "Withdraw" }).click();
    const dialog = page.getByRole("dialog", { name: "Withdraw earnings" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Amount").fill("1000");
    await dialog.getByRole("button", { name: "Confirm withdrawal" }).dblclick();
    await expect(page.getByText("Demo payout simulated — no money moved").first()).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await payouts()).toBe(before + 1);
  });
});

test.describe("T5 performance", () => {
  const targets = () => [
    { name: "landing", url: "/", role: null },
    { name: "customer-vehicles", url: `/customer/vehicles?from=coimbatore&to=chennai&weight=500&date=${tomorrowIst()}`, role: "customer" as const },
    { name: "driver-dashboard", url: "/driver/dashboard", role: "driver" as const },
  ];

  test("navigation timing, LCP, transfer size and image weights", async ({ browser }) => {
    test.setTimeout(180_000);
    const results: Record<string, unknown>[] = [];
    for (const t of targets()) {
      for (let run = 1; run <= 2; run++) {
        const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        if (t.role) await seedSession(page, t.role);
        await page.addInitScript(() => {
          (window as unknown as { __lcp: number }).__lcp = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) (window as unknown as { __lcp: number }).__lcp = e.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        });
        await page.goto(t.url, { waitUntil: "load" });
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(500);
        const m = await page.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
          const sum = (f: (r: PerformanceResourceTiming) => boolean) => res.filter(f).reduce((a, r) => a + r.transferSize, 0);
          const imgs = res.filter((r) => r.initiatorType === "img" || /\/_next\/image|\.(png|jpe?g|webp|avif)/.test(r.name));
          return {
            ttfbMs: Math.round(nav.responseStart - nav.startTime),
            domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
            loadMs: Math.round(nav.loadEventEnd - nav.startTime),
            lcpMs: Math.round((window as unknown as { __lcp: number }).__lcp),
            htmlBytes: nav.transferSize,
            jsBytes: sum((r) => /\.js(\?|$)/.test(r.name)),
            cssBytes: sum((r) => /\.css(\?|$)/.test(r.name)),
            imageBytes: imgs.reduce((a, r) => a + r.transferSize, 0),
            fontBytes: sum((r) => /\.(woff2?|ttf)(\?|$)/.test(r.name)),
            totalTransferBytes: nav.transferSize + res.reduce((a, r) => a + r.transferSize, 0),
            requests: res.length + 1,
            heavyImages: imgs.filter((r) => r.transferSize > 300 * 1024).map((r) => `${Math.round(r.transferSize / 1024)} KB ${r.name.replace(location.origin, "")}`),
            unoptimisedImgs: Array.from(document.images)
              .map((i) => i.currentSrc || i.src)
              .filter((s) => s && !s.includes("/_next/image") && !s.endsWith(".svg") && !s.startsWith("data:")),
          };
        });
        results.push({ page: t.name, run, ...m });
        await ctx.close();
      }
    }
    writeJson("perf.json", results);
    for (const r of results) {
      expect.soft((r as { heavyImages: string[] }).heavyImages, `${r.page} images > 300 KB`).toEqual([]);
      expect.soft((r as { unoptimisedImgs: string[] }).unoptimisedImgs, `${r.page} unoptimised <img>`).toEqual([]);
    }
  });
});
