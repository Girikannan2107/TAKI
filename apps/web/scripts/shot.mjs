#!/usr/bin/env node
/**
 * Dev helper: screenshot a page of the running dev server, optionally signed in
 * as a seeded demo user. Also prints console errors and horizontal overflow.
 *
 *   node scripts/shot.mjs /customer/dashboard out.png --as customer --width 1440 --height 900 [--full]
 *
 * Options: --as customer|driver (demo session injected into localStorage)
 *          --base http://localhost:3000   --width N  --height N  --full (full page)
 *          --wait ms (extra wait after load, default 800)
 */
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
// Git Bash rewrites "/x" to "C:/Program Files/Git/x" — undo that; also allow "customer/dashboard".
let path = (args[0] ?? "/").replace(/^[A-Za-z]:\/Program Files\/Git/, "");
if (!path.startsWith("/")) path = "/" + path;
const out = args[1] ?? "shot.png";
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const base = opt("base", "http://localhost:3000");
const as = opt("as", null);
const width = Number(opt("width", 1440));
const height = Number(opt("height", 900));
const full = args.includes("--full");
const wait = Number(opt("wait", 800));

const SESSIONS = {
  customer: { accountId: "usr_arjun", role: "customer", profileId: "cus_arjun" },
  driver: { accountId: "usr_ravi", role: "driver", profileId: "drv_ravi" },
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
if (as && SESSIONS[as]) {
  const now = Date.now();
  const session = { ...SESSIONS[as], issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 864e5).toISOString() };
  await context.addInitScript((value) => {
    try {
      const raw = localStorage.getItem("taki-demo-v1");
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 };
      if (!parsed.state?.session) {
        parsed.state = { ...(parsed.state ?? {}), session: value };
        localStorage.setItem("taki-demo-v1", JSON.stringify(parsed));
      }
    } catch {}
  }, session);
}
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + path, { waitUntil: "networkidle" });
await page.waitForTimeout(wait);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await page.screenshot({ path: out, fullPage: full });
console.log(JSON.stringify({ url: page.url(), overflowPx: overflow, consoleErrors: errors }, null, 2));
await browser.close();
