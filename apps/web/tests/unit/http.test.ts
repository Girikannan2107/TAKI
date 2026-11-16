import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * http.ts transport (v3): Bearer ID token from the main Firebase instance, explicit phone-proof bearer,
 * one forced refresh on 401 token_expired, sign-out hook on session_revoked, error envelope → ApiError.
 */
const getIdToken = vi.fn<(force?: boolean) => Promise<string>>();
let currentUser: { getIdToken: typeof getIdToken } | null = null;

vi.mock("@/lib/firebase/client", () => ({
  firebaseConfigured: () => true,
  mainAuth: () => ({ authStateReady: async () => undefined, get currentUser() { return currentUser; } }),
}));

const { http, setUnauthenticatedHandler, ApiError } = await import("@/lib/api/http");

type Call = { url: string; init: RequestInit };
let calls: Call[];

function respond(...responses: Array<{ status: number; body?: unknown }>) {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
}

const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

beforeEach(() => {
  calls = [];
  vi.stubGlobal("window", {});
  currentUser = { getIdToken };
  getIdToken.mockReset();
  getIdToken.mockImplementation(async (force) => (force ? "fresh-token" : "cached-token"));
  setUnauthenticatedHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("http (v3 transport)", () => {
  it("sends the session ID token as Bearer, omits cookies and parses JSON", async () => {
    respond({ status: 200, body: { ok: true } });
    await expect(http.get("/api/v1/me")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/v1/me");
    expect(header(calls[0]!, "authorization")).toBe("Bearer cached-token");
    expect(calls[0]!.init.credentials).toBe("omit");
  });

  it("sends no Authorization header when signed out", async () => {
    currentUser = null;
    respond({ status: 200, body: { user: null } });
    await http.get("/api/v1/auth/session");
    expect(header(calls[0]!, "authorization")).toBeUndefined();
  });

  it("uses an explicit phone-proof bearer instead of the session token", async () => {
    respond({ status: 200, body: { registered: false } });
    await http.post("/api/v1/auth/phone/status", {}, { bearer: "proof-token" });
    expect(header(calls[0]!, "authorization")).toBe("Bearer proof-token");
    expect(getIdToken).not.toHaveBeenCalled();
  });

  it("bearer: null sends no token at all (login)", async () => {
    respond({ status: 200, body: {} });
    await http.post("/api/v1/auth/login", { role: "customer" }, { bearer: null });
    expect(header(calls[0]!, "authorization")).toBeUndefined();
  });

  it("force-refreshes once and retries on 401 token_expired", async () => {
    respond({ status: 401, body: { error: { code: "token_expired", message: "Expired" } } }, { status: 200, body: { ok: 1 } });
    await expect(http.get("/api/v1/me")).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
    expect(header(calls[1]!, "authorization")).toBe("Bearer fresh-token");
    expect(getIdToken).toHaveBeenLastCalledWith(true);
  });

  it("does not retry twice and calls the sign-out hook on session_revoked", async () => {
    const onUnauth = vi.fn();
    setUnauthenticatedHandler(onUnauth);
    respond({ status: 401, body: { error: { code: "session_revoked", message: "Signed out" } } });
    await expect(http.get("/api/v1/me")).rejects.toMatchObject({ code: "session_revoked", status: 401 });
    expect(calls).toHaveLength(1);
    expect(onUnauth).toHaveBeenCalledOnce();
  });

  it("maps the error envelope (code, fields, details) to ApiError", async () => {
    respond({ status: 422, body: { error: { code: "address_not_found", message: "We couldn't find that address", fields: { "source.line1": "Not found" } } } });
    const err = await http.post("/api/v1/customer/shipments", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "address_not_found", status: 422, fields: { "source.line1": "Not found" } });
  });

  it("sends the Idempotency-Key and X-Phone-Proof headers when given", async () => {
    respond({ status: 201, body: {} });
    await http.post("/api/v1/payments/orders", { bookingId: "TAKI00000001" }, { idempotencyKey: "pay_abcdefgh", headers: { "x-phone-proof": "p" } });
    expect(header(calls[0]!, "idempotency-key")).toBe("pay_abcdefgh");
    expect(header(calls[0]!, "x-phone-proof")).toBe("p");
  });
});
