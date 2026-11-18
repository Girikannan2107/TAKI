import "server-only";
/**
 * Route-handler wrapper (P2 §8.1). Every `route.ts` uses it:
 *
 *   export const POST = handler(
 *     { auth: "agency", params: z.object({ bookingId: BookingIdSchema }), body: AcceptBody },
 *     async ({ params, session, now }) => toAgencyBookingView(await bookings.accept({ now, actor: session }, params.bookingId)),
 *   );
 *
 * It: checks Origin for non-GET (unless `csrf: false`), requires JSON content-type when a
 * `body` schema is given, parses body / query / params with zod, authenticates with D1's
 * `requireSession`, applies an optional rate limit, injects `now`, maps DomainError /
 * ZodError to `{ error: { code, message, fields?, details? } }`, and sets
 * `Cache-Control: no-store` on every response.
 *
 * Return a plain value → 200 JSON; `undefined` → 204; or use `created(x)`, `json(x, status)`,
 * `noContent()`, or any `Response`.
 */
import type { z } from "zod";
import { DomainError } from "@/lib/api/contracts/errors";
import { UPLOAD_LIMITS } from "@/lib/domain/constants";
import type { Role } from "@/lib/domain/model";
import { getSession, requireSession } from "../auth/guards";
import type { SessionContext } from "../core/context";
import { now as clockNow } from "../clock";
import { getDocStore } from "../db";
import { ensureDatabaseReachable } from "../db/emulator-probe";
import { NO_STORE_HEADERS, errorResponse } from "./errors";
import { clientIp, isAllowedOrigin } from "./origin";
import { hitRateLimit, type RateLimitRule } from "./rate-limit";

export type AuthSpec = "public" | "any" | Role | readonly Role[];

type AnySchema = z.ZodType;
type Out<S> = S extends AnySchema ? z.output<S> : undefined;
type SessionFor<A extends AuthSpec> = A extends "public" ? SessionContext | null : SessionContext;

export interface HandlerArgs<A extends AuthSpec, B, Q, P> {
  req: Request;
  body: Out<B>;
  query: Out<Q>;
  params: Out<P>;
  /** Present for authenticated routes; for "public" routes the optional session (or null). */
  session: SessionFor<A>;
  /** Server clock for this request. */
  now: Date;
  /** Client IP ("local" unless TRUST_PROXY_HEADERS=true). */
  ip: string;
  /** multipart/form-data body when `form: true`. */
  form: FormData | null;
}

export interface HandlerSpec<A extends AuthSpec, B extends AnySchema | undefined, Q extends AnySchema | undefined, P extends AnySchema | undefined> {
  auth: A;
  /** JSON body schema. Requires `Content-Type: application/json`. */
  body?: B;
  /** Parse multipart/form-data (validate fields yourself, e.g. `Schema.parse(Object.fromEntries(form))`). */
  form?: boolean;
  /** Query-string schema. Repeated keys become arrays. */
  query?: Q;
  /** Route params schema (validated after `await ctx.params`). */
  params?: P;
  /** Origin check for non-GET requests (default true). Disable only for webhooks / cron. */
  csrf?: boolean;
  /** Fixed-window rate limit; `bucket` builds the key (e.g. `booking:create:user:${session.userId}`). */
  rateLimit?: { rule: RateLimitRule; bucket: (a: { session: SessionContext | null; ip: string; req: Request }) => string } | null;
  /** Reject larger bodies before parsing (default 20 MB for forms, 1 MB for JSON). */
  maxBodyBytes?: number;
}

/** Second argument Next passes to route handlers. */
export interface RouteHandlerContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}

export type RouteHandler = (req: Request, ctx: RouteHandlerContext) => Promise<Response>;

const JSON_LIMIT = 1024 * 1024;

function withNoStore(res: Response): Response {
  if (!res.headers.has("cache-control")) {
    try {
      res.headers.set("cache-control", "no-store");
    } catch {
      // Immutable headers (e.g. Response.redirect): leave as is.
    }
  }
  return res;
}

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export function created(body: unknown, headers?: Record<string, string>): Response {
  return json(body, 201, headers);
}

export function noContent(headers?: Record<string, string>): Response {
  return new Response(null, { status: 204, headers: { ...NO_STORE_HEADERS, ...headers } });
}

function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : all[0]!;
  }
  return out;
}

function contentLength(req: Request): number | null {
  const v = req.headers.get("content-length");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function allowed(role: Role, auth: Exclude<AuthSpec, "public">): boolean {
  if (auth === "any") return true;
  if (typeof auth === "string") return auth === role;
  return auth.includes(role);
}

export function handler<
  A extends AuthSpec,
  B extends AnySchema | undefined = undefined,
  Q extends AnySchema | undefined = undefined,
  P extends AnySchema | undefined = undefined,
>(spec: HandlerSpec<A, B, Q, P>, fn: (args: HandlerArgs<A, B, Q, P>) => Promise<unknown> | unknown): RouteHandler {
  return async (req, ctx) => {
    try {
      const method = req.method.toUpperCase();
      const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
      if (mutating && spec.csrf !== false && !isAllowedOrigin(req)) throw new DomainError("bad_origin");
      // Fail fast (503) instead of hanging when the local Firestore emulator isn't running.
      await ensureDatabaseReachable();

      // Auth first (cheap rejection before parsing bodies).
      let session: SessionContext | null = null;
      if (spec.auth === "public") {
        try {
          session = await getSession(req);
        } catch {
          session = null;
        }
      } else {
        session = await requireSession(req, "any");
        if (!allowed(session.role, spec.auth as Exclude<AuthSpec, "public">)) throw new DomainError("forbidden");
      }

      const url = new URL(req.url);
      const ip = clientIp(req);
      const rawParams = ctx?.params ? await ctx.params : {};
      const params = spec.params ? spec.params.parse(rawParams) : undefined;
      const query = spec.query ? spec.query.parse(queryObject(url)) : undefined;

      let body: unknown = undefined;
      let form: FormData | null = null;
      const len = contentLength(req);
      if (spec.form) {
        const max = spec.maxBodyBytes ?? UPLOAD_LIMITS.maxRequestBytes;
        if (len !== null && len > max) throw new DomainError("file_too_large");
        const ct = req.headers.get("content-type") ?? "";
        if (!ct.toLowerCase().startsWith("multipart/form-data")) throw new DomainError("unsupported_media_type", "Send this request as multipart/form-data.");
        form = await req.formData();
      } else if (spec.body) {
        const max = spec.maxBodyBytes ?? JSON_LIMIT;
        if (len !== null && len > max) throw new DomainError("invalid_request", "Request body is too large.");
        const ct = req.headers.get("content-type") ?? "";
        if (!ct.toLowerCase().includes("application/json")) throw new DomainError("unsupported_media_type", "Send this request as application/json.");
        const text = await req.text();
        if (text.length > max) throw new DomainError("invalid_request", "Request body is too large.");
        body = spec.body.parse(text.trim() ? JSON.parse(text) : {});
      }

      const now = clockNow();
      if (spec.rateLimit) {
        await hitRateLimit(getDocStore(), spec.rateLimit.bucket({ session, ip, req }), spec.rateLimit.rule, now);
      }

      const result = await fn({ req, body, query, params, session, now, ip, form } as HandlerArgs<A, B, Q, P>);
      if (result instanceof Response) return withNoStore(result);
      if (result === undefined) return noContent();
      return json(result);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
