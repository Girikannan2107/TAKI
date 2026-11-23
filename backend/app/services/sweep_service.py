"""Scheduled sweep (P2 §13.3, E129). Owner: D4.

Correctness never depends on the sweep: unpaid holds stop counting at ``dueAt`` and every booking
transaction expires lazily. The sweep makes the stored state, notifications and refunds catch up.
Each step runs in bounded batches and is isolated (a failure is logged, the next step still runs).

Auth: a Google-signed OIDC token (Cloud Scheduler) with ``aud == SWEEP_OIDC_AUDIENCE`` and its
``email`` in ``SWEEP_INVOKER_EMAILS``, **or** ``Bearer CRON_SECRET``. Neither configured → 503
``cron_not_configured``. There is no unauthenticated bypass in any environment; tests configure a
``CRON_SECRET`` or inject an OIDC verifier with :func:`set_oidc_verifier`.

Step 6 of P2 §13.3 (orphan Auth users) belongs to D2's auth module and is reported as 0 here.
"""

from __future__ import annotations

import hmac
import logging
import time
from datetime import datetime
from typing import Any

import anyio
from google.cloud.firestore_v1.base_query import FieldFilter

from app.core.config import Settings
from app.core.errors import AppError
from app.repositories import bookings as bookings_repo
from app.repositories.base import C, doc_ref, get_db, query_docs
from app.services import booking_service, jobs_service

log = logging.getLogger("taki.sweep")

BATCH = 100


# ── authentication ────────────────────────────────────────────────────────────
def _verify_google_oidc(token: str, audience: str) -> dict[str, Any]:
    """Blocking: verifies a Google-signed ID token (signature, expiry, issuer, audience)."""
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token

    claims: dict[str, Any] = id_token.verify_oauth2_token(token, g_requests.Request(), audience=audience)
    return claims


OidcVerifier = Any
_verifier: OidcVerifier = _verify_google_oidc


def set_oidc_verifier(fn: OidcVerifier | None) -> None:
    """Tests inject a fake verifier (the real one fetches Google's certificates)."""
    global _verifier
    _verifier = fn or _verify_google_oidc


async def authorize(authorization: str | None, settings: Settings) -> str:
    """Returns the invoker (``email`` or ``cron_secret``). Raises 401 / 503."""
    secret = settings.CRON_SECRET.get_secret_value() if settings.CRON_SECRET else ""
    oidc_ready = bool(settings.SWEEP_OIDC_AUDIENCE and settings.SWEEP_INVOKER_EMAILS)
    if not secret and not oidc_ready:
        raise AppError("cron_not_configured")
    scheme, _, token = (authorization or "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise AppError("unauthenticated")
    if secret and hmac.compare_digest(token.encode(), secret.encode()):
        return "cron_secret"
    if oidc_ready:
        try:
            claims = await anyio.to_thread.run_sync(_verifier, token, settings.SWEEP_OIDC_AUDIENCE)
        except AppError:
            raise
        except Exception as e:  # noqa: BLE001 - any verification failure is a 401
            log.warning("sweep OIDC rejected: %s", type(e).__name__)
            raise AppError("unauthenticated") from e
        email = str(claims.get("email") or "")
        allowed = {e.lower() for e in settings.SWEEP_INVOKER_EMAILS}
        if claims.get("email_verified") is False or email.lower() not in allowed:
            raise AppError("unauthenticated")
        return email
    raise AppError("unauthenticated")


# ── steps ─────────────────────────────────────────────────────────────────────
async def _expire(rows: list[dict[str, Any]], now: datetime, kind: str) -> tuple[int, list[str]]:
    n, jobs = 0, []
    for b in rows:
        try:
            k, j = await booking_service.expire_if_due(b["id"], now)
        except AppError as e:
            log.warning("sweep: %s expiry of %s failed: %s", kind, b["id"], e.code)
            continue
        if k == kind:
            n += 1
        jobs += j
    return n, jobs


async def _expire_invites(now: datetime) -> int:
    q = (
        get_db()
        .collection(C.driver_invites)
        .where(filter=FieldFilter("status", "==", "pending"))
        .where(filter=FieldFilter("expiresAt", "<=", now))
        .limit(BATCH)
    )
    n = 0
    for inv in await query_docs(q):
        await doc_ref(C.driver_invites, inv["id"]).update({"status": "expired", "updatedAt": now})
        n += 1
    return n


async def run(now: datetime) -> dict[str, Any]:
    started = time.perf_counter()
    out: dict[str, Any] = {
        "expiredRequests": 0,
        "expiredPayments": 0,
        "reconciledPayments": 0,
        "jobsRun": 0,
        "jobsFailed": 0,
        "invitesExpired": 0,
        "orphanUsersDeleted": 0,
    }
    job_ids: list[str] = []
    try:
        out["expiredRequests"], j = await _expire(
            await bookings_repo.list_due_requests(now, BATCH), now, "expire_request"
        )
        job_ids += j
    except AppError as e:
        log.error("sweep step expire_requests failed: %s", e.code)
    try:
        out["expiredPayments"], j = await _expire(
            await bookings_repo.list_due_payments(now, BATCH), now, "expire_payment"
        )
        job_ids += j
    except AppError as e:
        log.error("sweep step expire_payments failed: %s", e.code)
    try:
        from app.services.payment_service import get_payment_service

        n, j = await get_payment_service().reconcile_pending(now=now)
        out["reconciledPayments"] = n
        job_ids += j
    except AppError as e:
        log.warning("sweep step reconcile skipped: %s", e.code)
    try:
        if job_ids:
            for status in (await jobs_service.run_jobs(job_ids, now)).values():
                out["jobsRun"] += 1 if status != "skipped" else 0
                out["jobsFailed"] += 1 if status == "failed" else 0
        ran, failed = await jobs_service.run_due_jobs(now)
        out["jobsRun"] += ran
        out["jobsFailed"] += failed
    except AppError as e:
        log.error("sweep step jobs failed: %s", e.code)
    try:
        out["invitesExpired"] = await _expire_invites(now)
    except AppError as e:
        log.error("sweep step invites failed: %s", e.code)
    out["durationMs"] = int((time.perf_counter() - started) * 1000)
    return out


__all__ = ["authorize", "run", "set_oidc_verifier"]
