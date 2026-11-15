import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/auth/passwords";
import { readCookie, serializeCookie, sessionCookieAttributes, signSessionCookie, verifySessionCookie } from "@/server/auth/session-cookie";
import { randomToken } from "@/server/auth/crypto";

describe("passwords (scrypt)", () => {
  it("hashes with a random salt and verifies in constant time", async () => {
    const a = await hashPassword("Sunrise2026");
    const b = await hashPassword("Sunrise2026");
    expect(a).toMatch(/^scrypt\$v1\$32768\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword("Sunrise2026", a)).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword("sunrise2026", a)).ok).toBe(false);
  });

  it("fails closed for unknown accounts and malformed hashes", async () => {
    expect((await verifyPassword("anything1", null)).ok).toBe(false);
    expect((await verifyPassword("anything1", "plain-text")).ok).toBe(false);
    expect((await verifyPassword("anything1", "scrypt$v1$99999999$8$1$AAAA$BBBB")).ok).toBe(false);
  });

  it("flags hashes with outdated parameters for rehash", async () => {
    const weak = await hashPassword("Sunrise2026", { N: 2 ** 14, r: 8, p: 1 });
    expect(await verifyPassword("Sunrise2026", weak)).toEqual({ ok: true, needsRehash: true });
  });

  it("enforces the password policy", () => {
    expect(passwordProblem("short1")).toMatch(/at least 8/);
    expect(passwordProblem("onlyletters")).toMatch(/number/);
    expect(passwordProblem("1234567890")).toMatch(/letter/);
    expect(passwordProblem("x".repeat(65) + "1")).toMatch(/at most/);
    expect(passwordProblem("9876543210", "+919876543210")).not.toBeNull();
    expect(passwordProblem("Sunrise2026", "+919876543210")).toBeNull();
  });
});

describe("session cookie (HMAC, Web Crypto)", () => {
  const SECRET = "test-secret-test-secret-test-secret-123";
  const sid = randomToken(32);
  const exp = Math.floor(Date.parse("2026-12-01T00:00:00Z") / 1000);
  const now = Date.parse("2026-11-20T00:00:00Z");

  it("round-trips a signed payload", async () => {
    const v = await signSessionCookie({ sid, r: "agency", exp }, SECRET);
    expect(await verifySessionCookie(v, now, SECRET)).toEqual({ sid, r: "agency", exp });
  });

  it("rejects tampering, a wrong secret, expiry and junk", async () => {
    const v = await signSessionCookie({ sid, r: "customer", exp }, SECRET);
    const [body, sig] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ sid, r: "admin", exp })).toString("base64url");
    expect(await verifySessionCookie(`${forged}.${sig}`, now, SECRET)).toBeNull();
    expect(await verifySessionCookie(`${body}.${sig!.slice(0, -2)}AA`, now, SECRET)).toBeNull();
    expect(await verifySessionCookie(v, now, SECRET + "x")).toBeNull();
    expect(await verifySessionCookie(v, exp * 1000 + 1, SECRET)).toBeNull();
    expect(await verifySessionCookie("not-a-cookie", now, SECRET)).toBeNull();
    expect(await verifySessionCookie(null, now, SECRET)).toBeNull();
  });

  it("serialises an httpOnly, SameSite=Lax cookie and reads it back", async () => {
    const value = await signSessionCookie({ sid, r: "driver", exp }, SECRET);
    const header = serializeCookie(sessionCookieAttributes(value, 3600));
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=3600");
    expect(readCookie(`other=1; ${header.split(";")[0]}`)).toBe(value);
    expect(serializeCookie(sessionCookieAttributes("", 0))).toContain("Max-Age=0");
  });
});
