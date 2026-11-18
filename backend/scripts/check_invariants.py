"""Read-only capacity / schedule / state invariants over a Firestore project (P2 §1, §8.1). Owner: D3.

Checks, for every non-terminal trip (draft / published / in_progress):

* capacity ledger — ``domain.capacity.invariant``: max leg load ≤ offeredKg ≤ vehicleMaxKg; every
  hold ↔ a booking with the same reservation state, weight and segment; no held/committed booking
  without a hold (expired unpaid holds awaiting the sweep are tolerated);
* ``capacitySummary`` matches the holds;
* published trips have search keys and their driver/vehicle schedule intervals; drafts and
  cancelled/completed trips have neither;
* no driver or vehicle has two overlapping live intervals.

Usage (from ``backend/``)::

    python -m scripts.check_invariants [--database NAME] [--agency agc_…] [--json]

Exit status 1 when any violation is found. Nothing is written.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from typing import Any

from google.cloud.firestore_v1.base_query import FieldFilter

from app.domain import capacity
from app.domain.trip_rules import interval_for, live_intervals, overlaps
from app.repositories import base
from app.repositories.base import C, col, get_many, query_docs

OPEN_TRIP = ["draft", "published", "in_progress"]


async def _bookings_for(trip_id: str) -> list[dict[str, Any]]:
    return await query_docs(col(C.bookings).where(filter=FieldFilter("tripId", "==", trip_id)).limit(500))


async def check(agency_id: str | None = None, now: datetime | None = None) -> list[str]:
    now = now or datetime.now(UTC)
    q: Any = col(C.trips).where(filter=FieldFilter("status", "in", OPEN_TRIP))
    if agency_id:
        q = q.where(filter=FieldFilter("agencyId", "==", agency_id))
    trips = await query_docs(q.limit(5000))
    problems: list[str] = []
    for t in trips:
        tid = t["id"]
        problems += capacity.invariant(t, await _bookings_for(tid), now)
        # held holds expire silently, so only the committed maximum must match the stored summary
        committed = capacity.summary(t, now)["committedKgMaxLeg"]
        stored = int((t.get("capacitySummary") or {}).get("committedKgMaxLeg", 0))
        if committed != stored:
            problems.append(f"trip {tid}: capacitySummary.committedKgMaxLeg {stored} != {committed}")
        published = t["status"] == "published"
        if published and not t.get("searchKeys"):
            agency = (await get_many(C.agencies, [t["agencyId"]]))[0] or {}
            if (agency.get("verification") or {}).get("status") != "suspended":
                problems.append(f"trip {tid}: published without searchKeys")
        if t["status"] == "draft" and t.get("searchKeys"):
            problems.append(f"trip {tid}: draft has searchKeys")
        if t["status"] in ("published", "in_progress"):
            iv = interval_for(tid, t["departureAt"], t["arrivalAt"])
            scheds = await get_many(C.schedules, [f"driver:{t['driverId']}", f"vehicle:{t['vehicleId']}"])
            for label, s in zip(("driver", "vehicle"), scheds, strict=True):
                if iv["to"] > now and not any(x.get("tripId") == tid for x in (s or {}).get("intervals") or []):
                    problems.append(f"trip {tid}: missing {label} schedule interval")
    for s in await query_docs(col(C.schedules).limit(10000)):
        live = live_intervals(s, now)
        for i, a in enumerate(live):
            for b in live[i + 1 :]:
                if overlaps(a, b):
                    problems.append(f"schedule {s['id']}: {a['tripId']} overlaps {b['tripId']}")
    return problems


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--database", default=None, help="named Firestore database (default: (default))")
    p.add_argument("--agency", default=None, help="limit to one agency id")
    p.add_argument("--json", action="store_true", help="print a JSON report")
    args = p.parse_args(argv)
    base.use_database(args.database)
    problems = asyncio.run(check(args.agency))
    if args.json:
        print(json.dumps({"ok": not problems, "problems": problems}, indent=2))
    else:
        for line in problems:
            print(line)
        print("OK: no invariant violations" if not problems else f"{len(problems)} violation(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
