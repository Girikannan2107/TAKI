import "server-only";
/**
 * Server error helpers. Throw `DomainError(code, message?, extra?)` (or `ApiError` for an
 * explicit status); the handler wrapper turns any thrown value into the JSON envelope
 *   { error: { code, message, fields?, details? } } with `Cache-Control: no-store`.
 */
import { ZodError } from "zod";
import { DomainError, type ErrorCode } from "@/lib/api/contracts/errors";

export { DomainError, type ErrorCode };

/** DomainError with an explicit HTTP status (e.g. `new ApiError("forbidden", 403)`). */
export class ApiError extends DomainError {
  constructor(code: ErrorCode, status?: number, message?: string, fields?: Record<string, string>, details?: Record<string, unknown>) {
    super(code, message, { status, fields, details });
    this.name = "ApiError";
  }
}

export const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

/** Flatten zod issues to { "a.b": "message" } (first message per path). */
export function zodFields(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function toDomainError(e: unknown): DomainError {
  if (e instanceof DomainError) return e;
  if (e instanceof ZodError) return new DomainError("invalid_request", undefined, { fields: zodFields(e) });
  if (e instanceof SyntaxError) return new DomainError("invalid_request", "The request body is not valid JSON.");
  return new DomainError("internal");
}

export function errorResponse(e: unknown, extraHeaders?: Record<string, string>): Response {
  const err = toDomainError(e);
  if (err.code === "internal") console.error("[taki] unhandled error", e);
  const headers: Record<string, string> = { ...NO_STORE_HEADERS, ...extraHeaders };
  const retry = err.details?.retryAfterSeconds;
  if (typeof retry === "number") headers["retry-after"] = String(Math.max(1, Math.ceil(retry)));
  return Response.json(err.toBody(), { status: err.status, headers });
}

export function notFound(): never {
  throw new DomainError("not_found");
}

export function forbidden(message?: string): never {
  throw new DomainError("forbidden", message);
}
