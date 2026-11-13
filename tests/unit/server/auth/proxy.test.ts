import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { randomToken } from "@/server/auth/crypto";
import { sessionCookieName, signSessionCookie } from "@/server/auth/session-cookie";
import type { Role } from "@/lib/domain/model";

async function cookieFor(role: Role): Promise<string> {
  const value = await signSessionCookie({ sid: randomToken(32), r: role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${sessionCookieName()}=${encodeURIComponent(value)}`;
}

async function run(path: string, cookie?: string) {
  const req = new NextRequest(new URL(path, "http://localhost:3000"), { headers: cookie ? { cookie } : {} });
  const res = await proxy(req);
  const location = res.headers.get("location");
  return { redirect: location ? new URL(location).pathname + new URL(location).search : null, setCookie: res.headers.get("set-cookie") };
}

describe("proxy (optimistic gate)", () => {
  it("sends guests to the section's login with ?next, but lets them browse public customer search", async () => {
    expect((await run("/agency/trips")).redirect).toBe("/auth/login?role=agency&next=%2Fagency%2Ftrips");
    expect((await run("/customer/shipments")).redirect).toBe("/auth/login?role=customer&next=%2Fcustomer%2Fshipments");
    expect((await run("/admin/agencies")).redirect).toBe("/admin/login?next=%2Fadmin%2Fagencies");
    expect((await run("/customer/dashboard")).redirect).toBeNull();
    expect((await run("/customer/vehicles?from=a")).redirect).toBeNull();
    expect((await run("/customer/booking/trp_x")).redirect).toBeNull();
    expect((await run("/admin/login")).redirect).toBeNull();
  });

  it("sends a signed-in user to their own dashboard from another role's section", async () => {
    expect((await run("/agency/dashboard", await cookieFor("driver"))).redirect).toBe("/driver/dashboard");
    expect((await run("/admin", await cookieFor("customer"))).redirect).toBe("/customer/dashboard");
    expect((await run("/agency/dashboard", await cookieFor("agency"))).redirect).toBeNull();
    expect((await run("/admin/drivers", await cookieFor("admin"))).redirect).toBeNull();
    // Public customer pages stay open to every role.
    expect((await run("/customer/vehicles", await cookieFor("agency"))).redirect).toBeNull();
  });

  it("keeps signed-in users off the auth pages unless switching accounts", async () => {
    expect((await run("/auth/login", await cookieFor("customer"))).redirect).toBe("/customer/dashboard");
    expect((await run("/auth/login?next=%2Fcustomer%2Fshipments", await cookieFor("customer"))).redirect).toBe("/customer/shipments");
    expect((await run("/auth/login?next=%2Fagency%2Ftrips", await cookieFor("customer"))).redirect).toBe("/customer/dashboard");
    expect((await run("/auth/login?switch=1", await cookieFor("customer"))).redirect).toBeNull();
    expect((await run("/signup/agency", await cookieFor("driver"))).redirect).toBe("/driver/dashboard");
  });

  it("treats a forged cookie as signed out and clears it", async () => {
    const forged = `${sessionCookieName()}=eyJzaWQiOiJ4In0.AAAA`;
    const r = await run("/driver/dashboard", forged);
    expect(r.redirect).toBe("/auth/login?role=driver&next=%2Fdriver%2Fdashboard");
    expect(r.setCookie).toContain("Max-Age=0");
  });
});
