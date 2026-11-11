/**
 * T4 — responsive layout + WCAG 2.2 AA audit (Phase 3).
 *
 * Runs per config project (desktop 1440, laptop 1280, tablet 768, mobile 390, small 360).
 * Each sweep collects metrics to test-results/t4/data/{project}-{group}.json (read by the QA report)
 * and asserts the hard gates softly so one run shows every failure:
 *   - no horizontal overflow (G-4), one h1 (G-2), no clipped CTAs / truncated ₹ values
 *   - axe wcag2a/aa, 21a/aa, 22aa: zero serious/critical (G-7) — at 1440 and 390 only
 *   - tap targets ≥ 24×24 at 390 (G-5, WCAG 2.5.8)
 * Keyboard, drawer, OTP, modal, skip-link and reduced-motion checks are separate tests.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUT = "test-results/t4";
const DAY = 864e5;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function istDate(days: number): string {
  return new Date(Date.now() + 5.5 * 3600e3 + days * DAY).toISOString().slice(0, 10);
}

type Role = "customer" | "driver";

function demoState(role: Role | null, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const state: Record<string, unknown> = { ...extra };
  if (role) {
    state.session = {
      accountId: role === "customer" ? "usr_arjun" : "usr_ravi",
      role,
      profileId: role === "customer" ? "cus_arjun" : "drv_ravi",
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * DAY).toISOString(),
    };
  }
  return JSON.stringify({ state, version: 1 });
}

const SEARCH = () => ({ sourceCityId: "coimbatore", destinationCityId: "chennai", weightKg: 500, pickupDate: istDate(1) });
const ROUTE_DRAFT = () => ({
  originCityId: "coimbatore",
  destinationCityId: "chennai",
  stopCityIds: ["salem", "vellore"],
  travelDate: istDate(3),
  departureTime: "08:00",
  vehicleId: "veh_raj",
  totalCapacityKg: 3000,
  offeredCapacityKg: 2000,
});

async function seed(page: Page, role: Role | null, extra: Record<string, unknown> = {}) {
  await page.addInitScript((value) => {
    // First load of the test only: later navigations keep the app's own state.
    if (!sessionStorage.getItem("t4-seeded")) {
      localStorage.setItem("taki-demo-v1", value);
      sessionStorage.setItem("t4-seeded", "1");
    }
  }, demoState(role, extra));
}

const width = (page: Page) => page.viewportSize()!.width;
const project = () => test.info().project.name;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  // Skeletons resolve after store hydration.
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

/* ------------------------------------------------------------------ page metrics (runs in the browser) */

function pageMetrics() {
  const vw = window.innerWidth;
  const desc = (el: Element) => {
    const h = el as HTMLElement;
    const cls = typeof h.className === "string" ? h.className.split(/\s+/).slice(0, 4).join(".") : "";
    const name = (h.getAttribute("aria-label") || h.textContent || (h as HTMLInputElement).placeholder || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${h.id ? "#" + h.id : ""}${cls ? "." + cls : ""} "${name}"`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("dialog:not([open]),[hidden],[inert]");
  };
  const srOnly = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width <= 1 || r.height <= 1;
  };
  // An ancestor that clips/scrolls horizontally (a deliberate scroller, e.g. Tabs).
  const inXScroller = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox !== "visible") return true;
    }
    return false;
  };

  const all = Array.from(document.body.querySelectorAll("*"));
  const overflowers = all
    .filter((el) => visible(el) && !srOnly(el) && !inXScroller(el))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > vw + 1 || r.left < -1;
    })
    .map((el) => `${desc(el)} [${Math.round(el.getBoundingClientRect().left)}→${Math.round(el.getBoundingClientRect().right)}]`)
    .slice(0, 8);

  const interactiveSel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [tabindex]:not([tabindex="-1"])';
  const targets = Array.from(document.querySelectorAll(interactiveSel)).filter((el) => visible(el));

  const targetRect = (el: Element): DOMRect => {
    // A native control inside / referenced by a <label> is activated by the label too.
    if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
      const lab = el.closest("label") || (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
      if (lab) return lab.getBoundingClientRect();
    }
    return el.getBoundingClientRect();
  };

  const small: string[] = [];
  const smallPrimary: string[] = [];
  const clippedCtas: string[] = [];
  for (const el of targets) {
    const r = targetRect(el);
    if (r.width <= 1 && r.height <= 1) continue; // sr-only without label
    const inline =
      el.tagName === "A" &&
      !!el.parentElement &&
      ["P", "LI", "SPAN", "SMALL"].includes(el.parentElement.tagName) &&
      (el.parentElement.textContent || "").trim().length > (el.textContent || "").trim().length + 3;
    if (r.width < 24 || r.height < 24) small.push(`${desc(el)} ${Math.round(r.width)}×${Math.round(r.height)}${inline ? " (inline-text link: exempt)" : ""}`);
    const cls = (el as HTMLElement).className?.toString?.() ?? "";
    const primary = /bg-grad-primary|bg-lime-300/.test(cls);
    if (primary && r.height < 44) smallPrimary.push(`${desc(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    if ((el.tagName === "BUTTON" || primary) && !inXScroller(el) && (r.right > vw + 1 || r.left < -1)) clippedCtas.push(desc(el));
  }

  // ₹ values clipped by overflow:hidden / ellipsis.
  const truncatedMoney = all
    .filter((el) => visible(el) && /₹/.test(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join("")))
    .filter((el) => {
      const cs = getComputedStyle(el);
      const clips = cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.textOverflow === "ellipsis";
      return clips && (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1;
    })
    .map(desc);

  // Text smaller than 12px (visible, leaf text).
  const tinyText = all
    .filter((el) => visible(el) && !srOnly(el) && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim()))
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
    .map((el) => `${desc(el)} ${getComputedStyle(el).fontSize}`)
    .slice(0, 6);

  const smallInputs =
    vw < 768
      ? Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea"))
          .filter((el) => visible(el) && !srOnly(el) && parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => `${desc(el)} ${getComputedStyle(el).fontSize}`)
      : [];

  const h1 = Array.from(document.querySelectorAll("h1")).map((h) => ({ text: h.textContent!.trim(), visible: visible(h) || srOnly(h) }));
  const landmarks = {
    mainMain: document.querySelectorAll("main#main").length,
    main: document.querySelectorAll("main").length,
    header: document.querySelectorAll("header").length,
    navs: Array.from(document.querySelectorAll("nav")).map((n) => n.getAttribute("aria-label") || n.getAttribute("aria-labelledby") || "(unlabelled)"),
    footer: document.querySelectorAll("footer").length,
  };
  const imgNoAlt = Array.from(document.querySelectorAll("img:not([alt])")).map(desc);
  const svgExposed = Array.from(document.querySelectorAll("svg"))
    .filter((s) => visible(s) && !s.closest('[aria-hidden="true"]') && !s.getAttribute("role") && !s.getAttribute("aria-label") && !s.querySelector("title"))
    .map((s) => desc(s.parentElement || s))
    .slice(0, 6);
  const ariaCurrent = Array.from(document.querySelectorAll("[aria-current]")).filter(visible).map((el) => `${el.getAttribute("aria-current")}: ${desc(el)}`);

  return {
    url: location.pathname + location.search,
    innerWidth: vw,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > vw,
    overflowers,
    h1,
    title: document.title,
    lang: document.documentElement.lang,
    landmarks,
    imgNoAlt,
    svgExposed,
    ariaCurrent,
    small,
    smallPrimary,
    clippedCtas,
    truncatedMoney,
    tinyText,
    smallInputs,
  };
}

type Metrics = ReturnType<typeof pageMetrics>;

interface AxeSummary {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: number;
  targets: string[];
  sample: string;
}

async function runAxe(page: Page, include?: string): Promise<AxeSummary[]> {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (include) builder = builder.include(include);
  const res = await builder.analyze();
  return res.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 6).map((n) => n.target.join(" ")),
    sample: (v.nodes[0]?.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 220),
  }));
}

interface PageResult {
  name: string;
  metrics: Metrics;
  axe?: AxeSummary[];
  screenshot?: string;
}

function save(group: string, data: unknown) {
  const dir = path.join(OUT, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${project()}-${group}.json`), JSON.stringify(data, null, 2));
}

async function audit(page: Page, name: string, results: PageResult[]) {
  await settle(page);
  const w = width(page);
  const metrics = await page.evaluate(pageMetrics);
  const r: PageResult = { name, metrics };
  if (w === 1440 || w === 390) r.axe = await runAxe(page);
  if (w === 390 || w === 360) {
    const dir = path.join(OUT, "screens");
    fs.mkdirSync(dir, { recursive: true });
    r.screenshot = path.join(dir, `${w}-${name}.png`);
    await page.screenshot({ path: r.screenshot, fullPage: true });
  }
  results.push(r);

  expect.soft(metrics.overflow, `${name}: horizontal overflow ${metrics.scrollWidth}>${metrics.innerWidth} ${metrics.overflowers.join(" | ")}`).toBe(false);
  expect.soft(metrics.h1.length, `${name}: h1 count`).toBe(1);
  expect.soft(metrics.clippedCtas, `${name}: CTAs outside viewport`).toEqual([]);
  expect.soft(metrics.truncatedMoney, `${name}: truncated ₹ values`).toEqual([]);
  if (r.axe) {
    const blocking = r.axe.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect.soft(blocking.map((v) => `${v.id} (${v.impact}) ${v.targets.join(", ")}`), `${name}: axe serious/critical`).toEqual([]);
  }
  if (w === 390) {
    const real = metrics.small.filter((s) => !s.includes("exempt"));
    expect.soft(real, `${name}: tap targets < 24px`).toEqual([]);
  }
}

/* ------------------------------------------------------------------ sweeps: every page × every viewport */

test.describe("responsive + axe sweep", () => {
  test.describe.configure({ timeout: 300_000 });

  test("public pages", async ({ page }) => {
    const results: PageResult[] = [];
    await seed(page, null);
    for (const [name, url] of [
      ["landing", "/"],
      ["signup", "/signup"],
      ["login", "/auth/login"],
      ["phone", "/auth/phone?flow=signup&role=customer"],
      ["404", "/t4-no-such-page"],
    ] as const) {
      await page.goto(url);
      await audit(page, name, results);
    }
    save("public", results);
  });

  test("auth flow pages (verify-otp, create-password)", async ({ page }) => {
    const results: PageResult[] = [];
    await page.goto("/auth/phone?flow=signup&role=customer");
    await page.getByLabel("Mobile number").fill("7" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"));
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page).toHaveURL(/\/auth\/verify-otp/);
    await audit(page, "verify-otp", results);
    const code = (await page.getByTestId("demo-otp-code").textContent())!.trim();
    await page.getByLabel("Digit 1 of 6").click();
    await page.keyboard.type(code);
    await expect(page).toHaveURL(/\/auth\/create-password/);
    await audit(page, "create-password", results);
    save("auth", results);
  });

  test("customer pages", async ({ page }) => {
    const results: PageResult[] = [];
    await seed(page, "customer", { search: SEARCH() });
    const tomorrow = istDate(1);
    for (const [name, url] of [
      ["c-dashboard", "/customer/dashboard"],
      ["c-vehicles", `/customer/vehicles?from=coimbatore&to=chennai&weight=500&date=${tomorrow}`],
      ["c-booking", "/customer/booking/rte_r1"],
    ] as const) {
      await page.goto(url);
      await audit(page, name, results);
    }
    await page.getByRole("button", { name: /Book This Vehicle/ }).click();
    await page.waitForURL(/\/customer\/payment\?bookingId=TAKI\d{6}/);
    await audit(page, "c-payment", results);
    await page.getByRole("button", { name: /^Pay ₹/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Booking placed!" })).toBeVisible({ timeout: 15_000 });
    await audit(page, "c-confirmation", results);
    for (const [name, url] of [
      ["c-tracking", "/customer/tracking/TAKI874523"],
      ["c-shipments", "/customer/shipments"],
      ["c-payments", "/customer/payments"],
      ["c-profile", "/customer/profile"],
    ] as const) {
      await page.goto(url);
      await audit(page, name, results);
    }
    save("customer", results);
  });

  test("driver pages", async ({ page }) => {
    const results: PageResult[] = [];
    await seed(page, "driver", { routeDraft: ROUTE_DRAFT() });
    for (const [name, url] of [
      ["d-pricing", "/driver/routes/new/pricing"],
      ["d-dashboard", "/driver/dashboard"],
      ["d-routes", "/driver/routes"],
      ["d-routes-new", "/driver/routes/new"],
      ["d-bookings", "/driver/bookings"],
      ["d-earnings", "/driver/earnings"],
      ["d-profile", "/driver/profile"],
      ["d-help", "/driver/help"],
    ] as const) {
      await page.goto(url);
      await audit(page, name, results);
    }
    save("driver", results);
  });
});

/* ------------------------------------------------------------------ dialogs / drawers */

interface DialogCheck {
  name: string;
  opened: boolean;
  accessibleName: string | null;
  ariaModal: string | null;
  isModal: boolean;
  focusInside: boolean;
  tabEscapes: string[];
  escCloses: boolean;
  focusReturned: boolean;
  notes: string[];
}

async function activeDesc(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { inDialog: false, desc: "body" };
    return {
      inDialog: !!el.closest("dialog[open]"),
      desc: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}"`,
    };
  });
}

/** Opens a dialog from `trigger` with the keyboard and checks focus management. Leaves it closed. */
async function checkDialog(page: Page, name: string, trigger: Locator, open?: () => Promise<void>): Promise<DialogCheck> {
  const out: DialogCheck = { name, opened: false, accessibleName: null, ariaModal: null, isModal: false, focusInside: false, tabEscapes: [], escCloses: false, focusReturned: false, notes: [] };
  await trigger.focus();
  if (open) await open();
  else await page.keyboard.press("Enter");
  const dialog = page.locator("dialog[open]").last();
  try {
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    out.notes.push("dialog did not open");
    return out;
  }
  out.opened = true;
  await page.waitForTimeout(300);
  const info = await dialog.evaluate((d) => {
    const labelledby = d.getAttribute("aria-labelledby");
    const name = d.getAttribute("aria-label") || (labelledby ? document.getElementById(labelledby)?.textContent?.trim() ?? null : null);
    const focusables = d.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])');
    return { name, ariaModal: d.getAttribute("aria-modal"), isModal: d.matches(":modal"), count: focusables.length };
  });
  out.accessibleName = info.name;
  out.ariaModal = info.ariaModal;
  out.isModal = info.isModal;
  out.focusInside = (await activeDesc(page)).inDialog;
  for (let i = 0; i < info.count + 2; i++) {
    await page.keyboard.press("Tab");
    const a = await activeDesc(page);
    // Leaving to the browser chrome ("body") is native <dialog> behaviour; landing on page content is a trap failure.
    if (!a.inDialog && a.desc !== "body") out.tabEscapes.push(a.desc);
  }
  await page.keyboard.press("Escape");
  out.escCloses = await dialog.waitFor({ state: "hidden", timeout: 3_000 }).then(() => true, () => false);
  await page.waitForTimeout(200);
  out.focusReturned = await trigger.evaluate((el) => el === document.activeElement).catch(() => false);
  if (!out.focusReturned) out.notes.push(`focus after close: ${(await activeDesc(page)).desc}`);
  return out;
}

function assertDialog(c: DialogCheck) {
  expect.soft(c.opened, `${c.name}: opened`).toBe(true);
  if (!c.opened) return;
  expect.soft(c.accessibleName, `${c.name}: accessible name`).toBeTruthy();
  expect.soft(c.isModal || c.ariaModal === "true", `${c.name}: modal`).toBe(true);
  expect.soft(c.focusInside, `${c.name}: focus moves inside`).toBe(true);
  expect.soft(c.tabEscapes, `${c.name}: Tab trapped`).toEqual([]);
  expect.soft(c.escCloses, `${c.name}: Esc closes`).toBe(true);
  expect.soft(c.focusReturned, `${c.name}: focus returns to trigger ${c.notes.join("; ")}`).toBe(true);
}

test.describe("navigation drawers (< 1024px)", () => {
  test("dashboard drawer — customer and driver", async ({ page }) => {
    test.skip(width(page) >= 1024, "sidebar is fixed at ≥ 1024");
    const report: Record<string, unknown>[] = [];
    await seed(page, "customer");
    for (const [role, url] of [["customer", "/customer/dashboard"], ["driver", "/driver/dashboard"]] as const) {
      if (role === "driver") {
        await page.evaluate((v) => localStorage.setItem("taki-demo-v1", v), demoState("driver"));
      }
      await page.goto(url);
      await settle(page);
      const sidebarVisible = await page.locator('aside[aria-label="Sidebar"]').isVisible();
      const menu = page.getByRole("button", { name: "Open menu" });
      await expect(menu).toBeVisible();
      const attrs = await menu.evaluate((b) => ({ expanded: b.getAttribute("aria-expanded"), controls: b.getAttribute("aria-controls"), haspopup: b.getAttribute("aria-haspopup") }));
      const check = await checkDialog(page, `${role} drawer`, menu);
      assertDialog(check);
      expect.soft(sidebarVisible, `${role}: desktop sidebar hidden`).toBe(false);
      expect.soft(attrs.expanded, `${role}: aria-expanded=false when closed`).toBe("false");

      // Reopen: aria-expanded, aria-current, axe in drawer-open state, then follow a nav link.
      await menu.click();
      const dialog = page.locator("dialog[open]").last();
      await dialog.waitFor();
      await page.waitForTimeout(350);
      const expandedOpen = await menu.getAttribute("aria-expanded");
      const current = await dialog.locator('[aria-current="page"]').allTextContents();
      const axe = width(page) === 390 ? await runAxe(page) : undefined;
      if (width(page) <= 390) await page.screenshot({ path: path.join(OUT, "screens", `${width(page)}-${role}-drawer-open.png`) });
      const links = dialog.locator("nav a[href]");
      const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      const target = hrefs.findIndex((h) => h && !url.endsWith(h) && h.startsWith(`/${role}/`));
      await links.nth(target).click();
      await page.waitForURL((u) => u.pathname === hrefs[target]);
      const closedAfterNav = await page.locator("dialog[open]").count();
      report.push({ role, attrs, check, expandedOpen, current, axe, navigatedTo: hrefs[target], openDialogsAfterNav: closedAfterNav });
      expect.soft(current.length, `${role}: aria-current in drawer`).toBeGreaterThan(0);
      expect.soft(closedAfterNav, `${role}: drawer closes after nav`).toBe(0);
      if (axe) expect.soft(axe.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id), `${role}: axe drawer-open`).toEqual([]);
    }
    save("drawer", report);
  });

  test("landing hamburger", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const burger = page.locator("header").getByRole("button", { name: /menu/i }).first();
    test.skip(!(await burger.isVisible().catch(() => false)), "hamburger hidden at this width");
    const attrs = await burger.evaluate((b) => ({ name: b.getAttribute("aria-label"), expanded: b.getAttribute("aria-expanded"), controls: b.getAttribute("aria-controls") }));
    const check = await checkDialog(page, "landing drawer", burger);
    assertDialog(check);
    await burger.click();
    const dialog = page.locator("dialog[open]").last();
    await dialog.waitFor();
    await page.waitForTimeout(350);
    if (width(page) <= 390) await page.screenshot({ path: path.join(OUT, "screens", `${width(page)}-landing-drawer-open.png`) });
    const axe = width(page) === 390 ? await runAxe(page) : undefined;
    const link = dialog.getByRole("link").filter({ hasText: /How|Features|About|Contact|Drivers|Customers/i }).first();
    const linkText = await link.textContent();
    await link.click();
    await page.waitForTimeout(800);
    const openAfter = await page.locator("dialog[open]").count();
    save("landing-drawer", { attrs, check, axe, linkText, hash: new URL(page.url()).hash, openAfter });
    expect.soft(openAfter, "landing drawer closes after link").toBe(0);
    if (axe) expect.soft(axe.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id), "axe landing drawer-open").toEqual([]);
  });
});

/* ------------------------------------------------------------------ keyboard */

interface FocusStop {
  desc: string;
  indicator: boolean;
  how: string;
  top: number;
  left: number;
  inViewport: boolean;
}

/** Tabs through the page; records each stop and whether a focus indicator is painted. */
async function tabWalk(page: Page, max = 45): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  await page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => {});
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let first = "";
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const one = (cs: CSSStyleDeclaration) => {
        if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) return `outline ${cs.outlineWidth} ${cs.outlineColor}`;
        if (/(^|,\s*)(rgba?\([^)]*\)\s+)?0px 0px 0px [1-9]/.test(cs.boxShadow)) return `ring ${cs.boxShadow.slice(0, 60)}`;
        return "";
      };
      // The element itself or its ::before/::after (stretched-link cards).
      const ring = (e: Element) => one(getComputedStyle(e)) || one(getComputedStyle(e, "::after")) || one(getComputedStyle(e, "::before"));
      let how = ring(el);
      const r0 = el.getBoundingClientRect();
      // Visually-hidden native inputs paint their focus on the wrapping label/card.
      if (!how && (r0.width <= 1 || r0.height <= 1 || getComputedStyle(el).opacity === "0")) {
        const host = el.closest("label") || el.parentElement;
        if (host) how = ring(host) ? `host ${ring(host)}` : "";
      }
      // Field wrappers paint the ring via :has(:focus-visible) / :focus-within (up to 3 ancestors).
      for (let p = el.parentElement, n = 0; !how && p && n < 3; p = p.parentElement, n++) {
        if (ring(p)) how = `ancestor ${ring(p)}`;
      }
      const r = el.getBoundingClientRect();
      const name = (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).placeholder || "").trim().replace(/\s+/g, " ").slice(0, 35);
      return {
        desc: `${el.tagName.toLowerCase()}${el.getAttribute("type") ? "[" + el.getAttribute("type") + "]" : ""} "${name}"`,
        indicator: !!how,
        how,
        top: Math.round(r.top + window.scrollY),
        left: Math.round(r.left),
        inViewport: r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth,
      };
    });
    if (!s) continue;
    const key = `${s.desc}@${s.top},${s.left}`;
    if (i === 0) first = key;
    else if (key === first) break;
    stops.push(s);
  }
  return stops;
}

test.describe("keyboard", () => {
  test.describe.configure({ timeout: 240_000 });

  test("skip link, focus visibility and order on forms", async ({ page }) => {
    test.skip(!["desktop", "mobile"].includes(project()), "desktop + mobile only");
    const out: Record<string, unknown> = {};
    const walks: Record<string, FocusStop[]> = {};

    // Guest pages first (a session would redirect /auth/* to the dashboard).
    for (const url of ["/auth/login", "/auth/phone?flow=signup&role=customer", "/signup", "/"]) {
      await page.goto(url);
      await settle(page);
      walks[url] = await tabWalk(page, url === "/" ? 40 : 30);
    }
    await page.goto("/auth/phone?flow=signup&role=customer");
    await page.getByLabel("Mobile number").fill("7" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"));
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page).toHaveURL(/\/auth\/verify-otp/);
    await settle(page);
    walks["/auth/verify-otp"] = await tabWalk(page, 25);
    const code = (await page.getByTestId("demo-otp-code").textContent())!.trim();
    await page.getByLabel("Digit 1 of 6").click();
    await page.keyboard.type(code);
    await expect(page).toHaveURL(/\/auth\/create-password/);
    await settle(page);
    walks["/auth/create-password"] = await tabWalk(page, 25);

    // Skip link on each layout family.
    const skip: Record<string, unknown> = {};
    const skipUrls = ["/", "/auth/login", "/t4-no-such-page"];
    await page.evaluate(() => localStorage.clear());
    for (const url of [...skipUrls, "/customer/dashboard"]) {
      if (url === "/customer/dashboard") await page.evaluate((v) => localStorage.setItem("taki-demo-v1", v), demoState("customer", { search: SEARCH() }));
      await page.goto(url);
      await settle(page);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Tab");
      const first = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const r = el.getBoundingClientRect();
        return { text: el.textContent?.trim(), href: el.getAttribute("href"), visible: r.width > 10 && r.height > 10 && r.top >= 0 };
      });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
      await page.keyboard.press("Tab");
      const after = await page.evaluate(() => !!document.activeElement?.closest("main#main"));
      skip[url] = { ...first, nextTabInsideMain: after };
      expect.soft(first.text, `${url}: first tab stop is skip link`).toBe("Skip to main content");
      expect.soft(first.visible, `${url}: skip link visible on focus`).toBe(true);
      expect.soft(after, `${url}: skip link moves into main`).toBe(true);
    }
    out.skip = skip;

    for (const url of ["/customer/dashboard", "/customer/booking/rte_r1"]) {
      await page.goto(url);
      await settle(page);
      walks[url] = await tabWalk(page, 35);
    }

    // Payment page: walk + arrow keys in the radio group.
    await page.goto("/customer/booking/rte_r1");
    await settle(page);
    await page.getByRole("button", { name: /Book This Vehicle/ }).click();
    await page.waitForURL(/\/customer\/payment/);
    await settle(page);
    walks["/customer/payment"] = await tabWalk(page, 35);
    const radios = page.getByRole("radio");
    const radioCount = await radios.count();
    await page.getByRole("radio", { checked: true }).focus();
    const before = await page.getByRole("radio", { checked: true }).getAttribute("value");
    await page.keyboard.press("ArrowDown");
    const afterDown = await page.getByRole("radio", { checked: true }).getAttribute("value");
    const focusedIsChecked = await page.evaluate(() => (document.activeElement as HTMLInputElement)?.checked === true);
    const group = await page.getByRole("group", { name: "Choose Payment Method" }).count();
    out.paymentRadios = { radioCount, before, afterDown, focusedIsChecked, groupNamed: group };
    expect.soft(afterDown, "ArrowDown moves payment selection").not.toBe(before);
    expect.soft(focusedIsChecked, "focus follows radio selection").toBe(true);

    // Driver add-route form.
    await page.evaluate((v) => localStorage.setItem("taki-demo-v1", v), demoState("driver"));
    await page.goto("/driver/routes/new");
    await settle(page);
    walks["/driver/routes/new"] = await tabWalk(page, 35);

    // Active nav item.
    await page.goto("/driver/bookings");
    await settle(page);
    out.ariaCurrentDriverBookings = await page.locator('[aria-current="page"]').evaluateAll((els) => els.map((e) => `${e.tagName} ${e.textContent?.trim()}`));

    out.walks = walks;
    for (const [url, stops] of Object.entries(walks)) {
      const missing = stops.filter((s) => !s.indicator).map((s) => s.desc);
      expect.soft(missing, `${url}: focus indicator missing`).toEqual([]);
    }
    save("keyboard", out);
  });

  test("OTP input: labels, auto-advance, backspace, paste", async ({ page }) => {
    test.skip(!["desktop", "small"].includes(project()), "desktop + 360 only");
    await page.goto("/auth/phone?flow=signup&role=customer");
    await page.getByLabel("Mobile number").fill("7" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"));
    await page.getByRole("button", { name: "Send OTP" }).click();
    await expect(page).toHaveURL(/\/auth\/verify-otp/);
    await settle(page);
    const code = (await page.getByTestId("demo-otp-code").textContent())!.trim();
    const meta = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("main input")) as HTMLInputElement[];
      const fs = inputs[0]?.closest("fieldset");
      return {
        labels: inputs.map((i) => i.getAttribute("aria-label")),
        inputmode: inputs.map((i) => i.inputMode),
        autocompleteFirst: inputs[0]?.autocomplete,
        legend: fs?.querySelector("legend")?.textContent?.trim() ?? null,
        widths: inputs.map((i) => Math.round(i.getBoundingClientRect().width)),
        rowRight: Math.round(Math.max(...inputs.map((i) => i.getBoundingClientRect().right))),
        live: Array.from(document.querySelectorAll("[aria-live],[role=status],[role=alert]")).map((e) => `${e.getAttribute("aria-live") ?? e.getAttribute("role")}: ${e.textContent?.trim().slice(0, 60)}`),
      };
    });
    const d = (n: number) => page.getByLabel(`Digit ${n} of 6`);
    await d(1).click();
    await page.keyboard.type("12");
    const afterType = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    await page.keyboard.press("Backspace");
    const afterBs1 = { focus: await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), d2: await d(2).inputValue() };
    await page.keyboard.press("Backspace");
    const afterBs2 = { focus: await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), d1: await d(1).inputValue(), d2: await d(2).inputValue() };

    // Countdown live region check: sample twice, 2.2 s apart.
    const liveA = await page.locator("[aria-live]").allTextContents();
    await page.waitForTimeout(2200);
    const liveB = await page.locator("[aria-live]").allTextContents();

    await d(1).focus();
    await page.evaluate((c) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", c);
      document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, code);
    const pasted = await page.waitForURL(/\/auth\/create-password/, { timeout: 8_000 }).then(() => "navigated to create-password", async () => (await Promise.all([1, 2, 3, 4, 5, 6].map((n) => d(n).inputValue()))).join(""));

    const out = { meta, afterType, afterBs1, afterBs2, liveA, liveB, liveChangesPerSecond: JSON.stringify(liveA) !== JSON.stringify(liveB), pasted };
    save("otp", out);
    expect.soft(meta.labels).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Digit ${n} of 6`));
    expect.soft(meta.legend, "OTP fieldset legend").toBeTruthy();
    expect.soft(meta.rowRight, "OTP row fits viewport").toBeLessThanOrEqual(width(page));
    expect.soft(afterType, "auto-advance").toBe("Digit 3 of 6");
    expect.soft(pasted, "paste 6 digits").toBe("navigated to create-password");
    expect.soft(out.liveChangesPerSecond, "countdown should not re-announce every second").toBe(false);
  });

  test("modals: View Route, Withdraw, Decline", async ({ page }) => {
    test.skip(!["desktop", "mobile"].includes(project()), "desktop + mobile only");
    const out: DialogCheck[] = [];
    const axe: Record<string, AxeSummary[]> = {};
    await seed(page, "customer");
    await page.goto("/customer/tracking/TAKI874523");
    await settle(page);
    out.push(await checkDialog(page, "View Route", page.getByRole("button", { name: "View Route" })));
    await page.getByRole("button", { name: "View Route" }).click();
    await page.locator("dialog[open]").waitFor();
    axe["View Route"] = await runAxe(page, "dialog[open]");
    await page.keyboard.press("Escape");

    await page.evaluate((v) => localStorage.setItem("taki-demo-v1", v), demoState("driver"));
    await page.goto("/driver/earnings");
    await settle(page);
    out.push(await checkDialog(page, "Withdraw", page.getByRole("button", { name: "Withdraw", exact: true })));
    // Withdraw error state: announced + described.
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    const dlg = page.locator("dialog[open]");
    await dlg.waitFor();
    await dlg.getByLabel("Amount").fill("10");
    await dlg.getByRole("button", { name: "Confirm withdrawal" }).click();
    await page.waitForTimeout(300);
    const withdrawErr = await dlg.getByLabel("Amount").evaluate((i) => {
      const ids = (i.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      return { invalid: i.getAttribute("aria-invalid"), describedby: ids.map((id) => document.getElementById(id)?.textContent?.trim()), alert: !!document.querySelector("dialog[open] [role=alert]") };
    });
    axe["Withdraw (error)"] = await runAxe(page, "dialog[open]");
    await page.keyboard.press("Escape");

    await page.goto("/driver/bookings");
    await settle(page);
    out.push(await checkDialog(page, "Decline confirm", page.getByRole("button", { name: /^Decline / }).first()));

    save(`modals`, { out, axe, withdrawErr });
    out.forEach(assertDialog);
    for (const [k, v] of Object.entries(axe)) expect.soft(v.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => x.id), `axe ${k}`).toEqual([]);
  });

  test("error states: announced, described, axe-clean", async ({ page }) => {
    test.skip(!["desktop", "mobile"].includes(project()), "desktop + mobile only");
    const out: Record<string, unknown> = {};
    const collect = (form: string) =>
      page.evaluate((formSel) => {
        const root = document.querySelector(formSel) ?? document;
        return Array.from(root.querySelectorAll('[aria-invalid="true"]')).map((el) => {
          const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
          const described = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
          const err = described.find((d) => /error|enter|valid|must|required|select|choose|at least|match/i.test(d.textContent || ""));
          return {
            field: el.getAttribute("aria-label") || el.id,
            describedText: described.map((d) => d.textContent?.trim()),
            announced: !!err && !!err.closest('[role=alert],[aria-live]'),
          };
        });
      }, form);

    await page.goto("/auth/phone?flow=signup&role=customer");
    await settle(page);
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.waitForTimeout(300);
    out.phone = { fields: await collect("main form"), axe: await runAxe(page) };

    await page.goto("/auth/login");
    await settle(page);
    await page.getByRole("button", { name: "Log In" }).click();
    await page.waitForTimeout(300);
    out.loginEmpty = { fields: await collect("main form"), axe: await runAxe(page) };
    await page.getByLabel("Mobile number").fill("9876543210");
    await page.getByLabel("Password", { exact: true }).fill("Wrong12345");
    await page.getByRole("button", { name: "Log In" }).click();
    await page.waitForTimeout(800);
    out.loginWrong = await page.evaluate(() => Array.from(document.querySelectorAll("[role=alert],[aria-live]")).map((e) => `${e.getAttribute("role") ?? "live=" + e.getAttribute("aria-live")}: ${e.textContent?.trim().slice(0, 80)}`));

    await page.goto("/");
    await settle(page);
    const contact = page.locator("form").filter({ has: page.getByRole("button", { name: /Send/i }) }).first();
    if (await contact.count()) {
      await contact.getByRole("button", { name: /Send/i }).click();
      await page.waitForTimeout(300);
      out.contact = { fields: await collect("form:has(button[type=submit])") };
    }

    await seed(page, "driver");
    await page.goto("/driver/routes/new");
    await settle(page);
    await page.getByRole("button", { name: /Next: Set Pricing/ }).click();
    await page.waitForTimeout(300);
    out.addRoute = { fields: await collect("main form"), axe: await runAxe(page) };

    save("errors", out);
    for (const k of ["phone", "loginEmpty", "addRoute"] as const) {
      const v = out[k] as { fields: { field: string; announced: boolean }[]; axe: AxeSummary[] };
      expect.soft(v.fields.length, `${k}: invalid fields flagged`).toBeGreaterThan(0);
      expect.soft(v.fields.filter((f) => !f.announced).map((f) => f.field), `${k}: errors announced + described`).toEqual([]);
      expect.soft(v.axe.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => `${x.id} ${x.targets.join(",")}`), `${k}: axe error state`).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ reduced motion */

test("prefers-reduced-motion: no large animations", async ({ page }) => {
  test.skip(!["desktop", "mobile"].includes(project()), "desktop + mobile only");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page, "customer");
  const out: Record<string, string[]> = {};
  for (const url of ["/", "/customer/dashboard", "/customer/tracking/TAKI874523", "/auth/login"]) {
    await page.goto(url);
    await settle(page);
    out[url] = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => {
          const t = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
          const timing = a.effect?.getComputedTiming();
          const r = t?.getBoundingClientRect();
          const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "anim";
          return `${name} ${timing?.duration}ms x${timing?.iterations} on ${t?.tagName.toLowerCase()}.${(t?.className?.toString() ?? "").split(" ").slice(0, 3).join(".")} ${r ? Math.round(r.width) + "×" + Math.round(r.height) : ""}`;
        }),
    );
  }
  save("motion", out);
  for (const [url, anims] of Object.entries(out)) {
    // Allow tiny spinners; flag anything that loops or moves a large area.
    const big = anims.filter((a) => /xInfinity/.test(a) || /(\d{3,})×(\d{2,})/.test(a));
    expect.soft(big, `${url}: animations under reduced motion`).toEqual([]);
  }
});
