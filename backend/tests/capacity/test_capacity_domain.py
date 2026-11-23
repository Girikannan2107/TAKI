"""Pure per-leg capacity ledger (P2 §8.1): loads, segment availability, holds, invariant."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.core.errors import AppError
from app.domain import capacity as cap

NOW = datetime(2026, 11, 20, 4, 30, tzinfo=UTC)


def trip(
    n_stops: int = 4, offered: int = 1000, vmax: int = 3000, holds: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {
        "id": "trp_x",
        "checkpoints": [{"index": i} for i in range(n_stops)],
        "capacity": {"vehicleMaxKg": vmax, "offeredKg": offered},
        "holds": holds or {},
    }


def hold(kg: int, i: int, j: int, state: str = "committed", due: datetime | None = None) -> dict[str, Any]:
    return {"kg": kg, "fromIndex": i, "toIndex": j, "state": state, "dueAt": due}


def test_leg_loads_and_segment_availability() -> None:
    t = trip(holds={"A": hold(600, 0, 1), "B": hold(300, 1, 3)})
    assert cap.leg_count(t) == 3
    assert cap.leg_loads(t, NOW) == [600, 300, 300]
    assert cap.available_kg(t, 0, 1, NOW) == 400
    assert cap.available_kg(t, 1, 3, NOW) == 700
    assert cap.available_kg(t, 0, 3, NOW) == 400  # most-loaded leg on the segment
    assert cap.fits(t, 700, 2, 3, NOW)
    assert not cap.fits(t, 701, 2, 3, NOW)
    assert cap.available_kg(t, 0, 1, NOW, exclude="A") == 1000
    assert cap.summary(t, NOW) == {"committedKgMaxLeg": 600, "heldKgMaxLeg": 0, "maxLegLoadKg": 600}
    assert cap.trip_available_kg(t, NOW) == 400


def test_t1b_disjoint_legs_fit_but_overlapping_does_not() -> None:
    t = trip()
    t["holds"] = cap.with_hold(t, "AB", 600, 0, 1, None, NOW, state="committed")
    t["holds"] = cap.with_hold(t, "BD", 600, 1, 3, None, NOW, state="committed")
    with pytest.raises(AppError) as e:
        cap.with_hold(t, "AD", 500, 0, 3, None, NOW)
    assert e.value.code == "insufficient_capacity"
    assert e.value.details == {"availableKg": 400}


def test_held_holds_stop_counting_at_due_at() -> None:
    t = trip(holds={"H": hold(900, 0, 3, "held", NOW + timedelta(minutes=5))})
    assert cap.available_kg(t, 0, 3, NOW) == 100
    assert cap.available_kg(t, 0, 3, NOW + timedelta(minutes=5)) == 1000
    assert not cap.is_active(hold(1, 0, 1, "held", None), NOW)
    assert cap.summary(t, NOW)["heldKgMaxLeg"] == 900


def test_commit_release_extend() -> None:
    t = trip()
    due = NOW + timedelta(minutes=10)
    t["holds"] = cap.with_hold(t, "B1", 200, 1, 2, due, NOW)
    assert t["holds"]["B1"]["state"] == "held"
    later = NOW + timedelta(minutes=20)
    t["holds"] = cap.extended(t, "B1", later)
    assert t["holds"]["B1"]["dueAt"] == later
    t["holds"] = cap.extended(t, "B1", due)  # never earlier
    assert t["holds"]["B1"]["dueAt"] == later
    t["holds"] = cap.committed(t, "B1")
    assert t["holds"]["B1"] == {"kg": 200, "fromIndex": 1, "toIndex": 2, "state": "committed", "dueAt": None}
    t["holds"] = cap.released(t, "B1")
    assert t["holds"] == {}
    assert cap.released(t, "missing") == {}


def test_replacing_own_hold_is_idempotent() -> None:
    t = trip(offered=500)
    t["holds"] = cap.with_hold(t, "B1", 500, 0, 3, None, NOW, state="committed")
    t["holds"] = cap.with_hold(t, "B1", 500, 0, 3, None, NOW, state="committed")  # excludes itself
    assert cap.max_leg_load(t, NOW) == 500


def test_invalid_segment() -> None:
    with pytest.raises(ValueError):
        cap.available_kg(trip(), 2, 2, NOW)
    with pytest.raises(ValueError):
        cap.available_kg(trip(), 0, 4, NOW)


def test_offered_bounds() -> None:
    t = trip(holds={"A": hold(600, 0, 1)})
    assert cap.can_set_offered(t, 600, NOW) == (True, 600)
    assert cap.can_set_offered(t, 599, NOW) == (False, 600)
    assert cap.can_set_offered(t, 3001, NOW)[0] is False


def test_invariant() -> None:
    t = trip(holds={"A": hold(600, 0, 2), "B": hold(300, 1, 3, "held", NOW + timedelta(hours=1))})
    bookings = [
        {
            "id": "A",
            "reservationStatus": "committed",
            "weightKg": 600,
            "pickup": {"checkpointIndex": 0},
            "drop": {"checkpointIndex": 2},
        },
        {
            "id": "B",
            "reservationStatus": "held",
            "weightKg": 300,
            "pickup": {"checkpointIndex": 1},
            "drop": {"checkpointIndex": 3},
        },
        {"id": "C", "reservationStatus": "held", "weightKg": 50, "paymentDueAt": NOW - timedelta(minutes=1)},
    ]
    assert cap.invariant(t, bookings, NOW) == []
    bad = trip(offered=800, holds={"A": hold(600, 0, 2), "X": hold(300, 1, 2)})
    problems = cap.invariant(
        bad,
        [
            {"id": "A", "reservationStatus": "released", "weightKg": 500},
            {"id": "Z", "reservationStatus": "committed", "weightKg": 1},
        ],
        NOW,
    )
    joined = "\n".join(problems)
    assert "max leg load 900" in joined
    assert "hold X has no booking" in joined
    assert "booking reservation is released" in joined
    assert "booking weighs 500" in joined
    assert "booking Z is committed without a hold" in joined
    assert any("offered" in p and "vehicle max" in p for p in cap.invariant(trip(offered=5000), [], NOW))
