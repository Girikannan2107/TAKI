/**
 * Browser fetch wrapper for the TAKI API (FastAPI, `/api/v1`, P2 §5.6 / P3 §3.3). JSON in/out, Firebase ID
 * token as `Authorization: Bearer`, optional Idempotency-Key, and a typed `ApiError` on non-2xx responses.
 *
 *   const trip = await http.get<AgencyTripDTO>(`/api/v1/agency/trips/${id}`);
 *   await http.post("/api/v1/customer/bookings", { shipmentId, tripId }, { idempotencyKey });
 *   await http.postForm("/api/v1/driver/shipments/TAKI12345678/deliver", formData);
 *
 * Base URL: `NEXT_PUBLIC_API_BASE_URL` (the FastAPI origin, e.g. https://api.example.com). Empty = same
 * origin, where next.config.ts `rewrites()` proxies `/api/v1/*` to the local API (dev / e2e).
 * No cookies are sent (`credentials: "omit"`): there is no CSRF surface.
 * 401 `token_expired` → force-refresh the token once and retry; 401 `session_revoked` / `unauthenticated`
 * with a signed-in user → sign out (guards then send the user to login).
 */
import type { ApiErrorBody } from "./contracts/errors";
import { messageForCode } from "./contracts/errors";
import { mainAuth, firebaseConfigured } from "@/lib/firebase/client";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly details?: Record<string, unknown>;

  constructor(code: string, status: number, message: string, fields?: Record<string, string>, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.details = details;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** User-facing message for any thrown value. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export interface RequestOptions {
  /** Sent as the `Idempotency-Key` header (required by booking request and payment create). */
  idempotencyKey?: string;
  /**
   * Bearer to send instead of the session token (the phone-proof token for E4–E7 / E9). `null` sends no
   * Authorization header at all (public endpoints that must not see a session, e.g. login).
   */
  bearer?: string | null;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | readonly string[] | null | undefined>;
}

function withQuery(path: string, query: RequestOptions["query"]): string {
  if (!query) return path;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const item of v) sp.append(k, String(item));
    else sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    body = null;
  }
  const err = body?.error;
  if (err && typeof err.code === "string") {
    return new ApiError(err.code, res.status, err.message || messageForCode(err.code), err.fields, err.details);
  }
  const code = res.status === 401 ? "unauthenticated" : res.status === 404 ? "not_found" : res.status === 429 ? "rate_limited" : "internal";
  return new ApiError(code, res.status, messageForCode(code));
}

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");

/** Absolute URL for an API path (`/api/v1/...`). */
export function apiUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`;
}

/** Called when the API rejects the session for good (revoked / unknown user). Set by the session store. */
let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: (() => void) | null): void {
  onUnauthenticated = fn;
}

async function sessionToken(force: boolean): Promise<string | null> {
  if (typeof window === "undefined" || !firebaseConfigured()) return null;
  const auth = mainAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  return user ? user.getIdToken(force) : null;
}

async function request<T>(method: string, path: string, body: unknown, opts: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...opts.headers };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const usesSession = opts.bearer === undefined;
  let token: string | null = null;
  try {
    token = usesSession ? await sessionToken(retried) : opts.bearer ?? null;
  } catch {
    token = null; // a broken token cache must not block public calls; the API answers 401 where it matters
  }
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(apiUrl(withQuery(path, opts.query)), { method, headers, body: payload, credentials: "omit", cache: "no-store", signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("network_error", 0, "You appear to be offline. Check your connection and try again.");
  }
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401 && usesSession && token) {
      if (err.code === "token_expired" && !retried) return request<T>(method, path, body, opts, true);
      if (err.code === "session_revoked" || err.code === "unauthenticated") onUnauthenticated?.();
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const http = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PUT", path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("PATCH", path, body ?? {}, opts),
  delete: <T = void>(path: string, opts?: RequestOptions) => request<T>("DELETE", path, undefined, opts),
  /** multipart/form-data upload (do not set content-type; the browser adds the boundary). */
  postForm: <T>(path: string, form: FormData, opts?: RequestOptions) => request<T>("POST", path, form, opts),
  putForm: <T>(path: string, form: FormData, opts?: RequestOptions) => request<T>("PUT", path, form, opts),
};

/** New random idempotency key for one user intent (e.g. arming a Request button). */
export function newIdempotencyKey(prefix = "k"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${rand}`;
}
