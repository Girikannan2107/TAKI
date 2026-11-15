import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireSession, renewSessionIfNeeded } from "@/server/auth/guards";
import { revokeSession } from "@/server/auth/sessions";
import { login } from "@/server/modules/auth/service";
import { IP, NOW, PASSWORD, at, clearStores, e164, freshStores, makeCustomer, sessionFrom } from "./helpers";

const DAY = 86_400_000;

beforeEach(() => {
  freshStores();
  // requireSession reads the wall clock; pin it to the test clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  clearStores();
});

function requestWith(setCookie?: string): Request {
  return new Request("http://localhost/api/me", { headers: setCookie ? { cookie: setCookie.split(";")[0]! } : {} });
}

describe("requireSession", () => {
  it("returns the caller for a valid cookie and enforces the role", async () => {
    const c = await makeCustomer();
    const ctx = await requireSession(requestWith(c.setCookie), "customer");
    expect(ctx).toMatchObject({ role: "customer", userId: c.session.userId, phone: e164("9876500001"), name: "Asha Raman" });
    await expect(requireSession(requestWith(c.setCookie), ["customer", "agency"])).resolves.toMatchObject({ role: "customer" });
    await expect(requireSession(requestWith(c.setCookie), "agency")).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(requireSession(requestWith(c.setCookie), "admin")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("treats a missing, forged, revoked or expired session as unauthenticated", async () => {
    const c = await makeCustomer();
    await expect(requireSession(requestWith())).rejects.toMatchObject({ code: "unauthenticated", status: 401 });

    const [pair] = c.setCookie.split(";");
    const forged = pair!.slice(0, -2) + (pair!.endsWith("AA") ? "BB" : "AA");
    await expect(requireSession(requestWith(forged))).rejects.toMatchObject({ code: "unauthenticated" });

    vi.setSystemTime(at(7 * DAY + 1000));
    await expect(requireSession(requestWith(c.setCookie))).rejects.toMatchObject({ code: "unauthenticated" });

    vi.setSystemTime(NOW);
    const second = await login({ role: "customer", phone: e164("9876500001"), password: PASSWORD }, NOW, { ip: IP });
    const ctx = await requireSession(requestWith(second.setCookie));
    await revokeSession(ctx.sessionId, NOW);
    await expect(requireSession(requestWith(second.setCookie))).rejects.toMatchObject({ code: "unauthenticated" });
    // Revoking one session leaves the user's other sessions alive.
    await expect(requireSession(requestWith(c.setCookie))).resolves.toMatchObject({ role: "customer" });
  });
});

describe("sliding renewal", () => {
  it("does nothing while more than 24 h remain", async () => {
    const c = await makeCustomer();
    const res = new Response(null);
    await renewSessionIfNeeded(requestWith(c.setCookie), res, c.session, at(5 * DAY));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("extends by 7 days when under 24 h remain, capped at 30 days from creation", async () => {
    const c = await makeCustomer();
    let cookie = c.setCookie;
    let ctx = c.session;
    const expiries: number[] = [];

    for (const day of [6.5, 13, 19.5, 26]) {
      const now = at(day * DAY);
      const res = new Response(null);
      await renewSessionIfNeeded(requestWith(cookie), res, ctx, now);
      const next = res.headers.get("set-cookie");
      expect(next, `renewed on day ${day}`).toBeTruthy();
      cookie = next!;
      const renewed = await sessionFrom(cookie, now);
      expect(renewed?.sessionId).toBe(ctx.sessionId);
      ctx = renewed!;
      expiries.push(Date.parse(ctx.expiresAt));
    }

    expect(expiries.slice(0, 3)).toEqual([at(13.5 * DAY), at(20 * DAY), at(26.5 * DAY)].map((d) => d.getTime()));
    expect(expiries[3]).toBe(at(30 * DAY).getTime());

    // At the cap: no further renewal, and the session ends at day 30.
    const res = new Response(null);
    await renewSessionIfNeeded(requestWith(cookie), res, ctx, at(29.5 * DAY));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await sessionFrom(cookie, at(30 * DAY + 1000))).toBeNull();
  });

  it("ignores a cookie that belongs to a different session", async () => {
    const a = await makeCustomer("9876500011");
    const b = await makeCustomer("9876500012");
    const res = new Response(null);
    await renewSessionIfNeeded(requestWith(b.setCookie), res, a.session, at(6.5 * DAY));
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
