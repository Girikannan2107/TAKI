/**
 * Browser fetch wrapper for the TAKI API (P2 §8.9). JSON in/out, same-origin cookies,
 * optional Idempotency-Key, and a typed `ApiError` on non-2xx responses.
 *
 *   const trip = await http.get<AgencyTripDTO>(`/api/agency/trips/${id}`);
 *   await http.post("/api/customer/bookings", { shipmentId, tripId }, { idempotencyKey });
 *   await http.postForm("/api/driver/shipments/TAKI123456/deliver", formData);
 */
import type { ApiErrorBody } from "./contracts/errors";
import { messageForCode } from "./contracts/errors";

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

async function request<T>(method: string, path: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...opts.headers };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(withQuery(path, opts.query), { method, headers, body: payload, credentials: "same-origin", cache: "no-store", signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("network_error", 0, "You appear to be offline. Check your connection and try again.");
  }
  if (!res.ok) throw await parseError(res);
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
