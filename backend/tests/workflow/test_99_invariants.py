"""T2 §6.2 item 14: database checks after the whole suite (runs last; the data is kept).

* ``scripts/check_invariants.py --database t2-workflow``: capacity ledger, holds ↔ bookings,
  capacitySummary, search keys and schedule intervals, no overlapping live intervals;
* no ``password`` / raw document number anywhere; every booking's stored status equals the
  four-field derivation; every open trip's holds match its bookings.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from app.repositories.base import C, col, get_db, query_docs
from tests.workflow import support as S

pytestmark = pytest.mark.emulator

BACKEND = Path(__file__).resolve().parents[2]


def test_check_invariants_script() -> None:
    env = {**os.environ, "FIRESTORE_EMULATOR_HOST": os.environ.get("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")}
    p = subprocess.run(  # noqa: S603 - fixed argv
        [sys.executable, "-m", "scripts.check_invariants", "--database", S.TEST_DATABASE, "--json"],
        cwd=BACKEND, env=env, capture_output=True, text=True, timeout=300, check=False,
    )
    assert p.returncode == 0, p.stdout[-3000:] + p.stderr[-3000:]


def _walk(x: Any, path: str = "") -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    if isinstance(x, dict):
        for k, v in x.items():
            out.append((f"{path}.{k}", v))
            out += _walk(v, f"{path}.{k}")
    elif isinstance(x, list):
        for i, v in enumerate(x):
            out += _walk(v, f"{path}[{i}]")
    return out


async def test_no_secrets_or_raw_document_numbers() -> None:
    names = [c.id async for c in get_db().collections()]
    assert C.bookings in names and C.users in names, names
    raw_numbers = {S.AADHAAR, "ABCDE1234F", "TN0120190001234"}
    problems: list[str] = []
    for name in names:
        for d in await query_docs(col(name).limit(2000)):
            for p, v in _walk(d):
                key = p.rsplit(".", 1)[-1]
                if key.lower() in ("password", "plainpassword", "otp", "pickupotp", "deliveryotp"):
                    problems.append(f"{name}/{d.get('id')}: field {p}")
                if isinstance(v, str) and v in raw_numbers:
                    problems.append(f"{name}/{d.get('id')}: raw document number at {p}")
    assert not problems, problems[:20]


async def test_booking_status_matches_state_fields_and_holds() -> None:
    from app.domain.booking_machine import derive as derive_status

    trips = {t["id"]: t for t in await query_docs(col(C.trips).limit(2000))}
    problems: list[str] = []
    for b in await query_docs(col(C.bookings).limit(5000)):
        d = derive_status(b)
        st = d.get("status") if isinstance(d, dict) else getattr(d, "status", d)
        if st != b.get("status"):
            problems.append(f"{b['id']}: stored status {b.get('status')} != derived {st}")
        t = trips.get(b["tripId"]) or {}
        hold = (t.get("holds") or {}).get(b["id"])
        if b["reservationStatus"] in ("released", "consumed", "none") and hold is not None:
            problems.append(f"{b['id']}: reservation {b['reservationStatus']} but trip still holds it")
        if b["reservationStatus"] == "committed" and (hold is None or hold.get("state") != "committed"):
            if t.get("status") in ("published", "in_progress"):
                problems.append(f"{b['id']}: committed but trip hold is {hold}")
        if b["paymentStatus"] == "paid" and b.get("closure"):
            problems.append(f"{b['id']}: paid but closed")
    assert not problems, json.dumps(problems[:20], indent=1)
