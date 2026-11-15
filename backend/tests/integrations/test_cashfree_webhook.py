"""Cashfree webhook signature, timestamp and event parsing (pure; no emulator)."""

from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta

import pytest

from app.core.errors import AppError
from app.integrations.cashfree.models import CfPayment
from app.integrations.cashfree.webhook import (
    compute_signature,
    is_fresh_timestamp,
    parse_event,
    redact_payload,
    verify_signature,
    verify_webhook,
)
from app.tests_support.fake_cashfree import TEST_SECRET, signed_webhook

NOW = datetime(2026, 11, 16, 4, 30, tzinfo=UTC)
TS_MS = str(int(NOW.timestamp() * 1000))
TS_S = str(int(NOW.timestamp()))
BODY = b'{"data":{"order":{"order_id":"pay_x"}},"type":"PAYMENT_SUCCESS_WEBHOOK"}'


def test_golden_vector_matches_independent_hmac() -> None:
    expected = base64.b64encode(hmac.new(b"secret123", b"1700000000000" + b'{"a":1}', hashlib.sha256).digest()).decode()
    assert compute_signature("secret123", "1700000000000", b'{"a":1}') == expected
    assert expected == "A1XsjIIKy3LUCuk+cW3Jjl8rQqu/i+sY85eJ6poD83I="  # golden vector


def test_valid_signature_accepts_ms_and_seconds_timestamps() -> None:
    for ts in (TS_MS, TS_S):
        sig = compute_signature(TEST_SECRET, ts, BODY)
        assert verify_signature(TEST_SECRET, ts, BODY, sig)
        verify_webhook(
            secret=TEST_SECRET,
            headers={"x-webhook-signature": sig, "x-webhook-timestamp": ts},
            raw_body=BODY,
            now=NOW,
        )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda sig, ts, body: (sig, ts, body + b" "),  # body re-serialised / tampered
        lambda sig, ts, body: (sig, str(int(ts) + 1), body),  # timestamp swapped
        lambda sig, ts, body: ("A" + sig[1:], ts, body),  # signature tampered
        lambda sig, ts, body: ("not base64!!", ts, body),
        lambda sig, ts, body: ("", ts, body),
        lambda sig, ts, body: (sig, "", body),
    ],
)
def test_invalid_signature_rejected(mutate) -> None:  # type: ignore[no-untyped-def]
    sig = compute_signature(TEST_SECRET, TS_MS, BODY)
    s, ts, body = mutate(sig, TS_MS, BODY)
    assert not verify_signature(TEST_SECRET, ts, body, s)
    with pytest.raises(AppError) as exc:
        verify_webhook(
            secret=TEST_SECRET, headers={"x-webhook-signature": s, "x-webhook-timestamp": ts}, raw_body=body, now=NOW
        )
    assert exc.value.code == "invalid_signature" and exc.value.status == 401


def test_wrong_secret_rejected() -> None:
    sig = compute_signature("another-secret", TS_MS, BODY)
    assert not verify_signature(TEST_SECRET, TS_MS, BODY, sig)


def test_unsigned_webhook_rejected() -> None:
    with pytest.raises(AppError) as exc:
        verify_webhook(secret=TEST_SECRET, headers={}, raw_body=BODY, now=NOW)
    assert exc.value.code == "invalid_signature"


def test_stale_timestamp_rejected_even_with_valid_signature() -> None:
    old = str(int((NOW - timedelta(minutes=6)).timestamp() * 1000))
    sig = compute_signature(TEST_SECRET, old, BODY)
    with pytest.raises(AppError) as exc:
        verify_webhook(
            secret=TEST_SECRET, headers={"x-webhook-signature": sig, "x-webhook-timestamp": old}, raw_body=BODY, now=NOW
        )
    assert exc.value.code == "stale_timestamp" and exc.value.status == 401


def test_timestamp_window() -> None:
    assert is_fresh_timestamp(str(int((NOW + timedelta(minutes=4)).timestamp())), NOW)
    assert not is_fresh_timestamp(str(int((NOW + timedelta(minutes=6)).timestamp())), NOW)
    assert not is_fresh_timestamp("12345", NOW)
    assert not is_fresh_timestamp("17000000000000000", NOW)
    assert not is_fresh_timestamp(None, NOW)


def test_parse_payment_success_event() -> None:
    payment = CfPayment(
        cf_payment_id=5114915,
        payment_status="SUCCESS",
        payment_amount=1234.5,
        payment_group="credit_card",
        payment_method={"card": {"card_number": "XXXXXXXXXXXX1111"}},
    )
    body, _ = signed_webhook("PAYMENT_SUCCESS_WEBHOOK", "pay_abc", payment=payment, amount_rupees=1234.5)
    ev = parse_event(body)
    assert ev is not None
    assert ev.kind == "payment_succeeded"
    assert ev.order_id == "pay_abc"
    assert ev.amount_paise == 123450
    assert ev.provider_payment_id == "5114915"
    assert ev.method_label == "Credit Card ••1111"
    assert ev.event_key == "PAYMENT_SUCCESS_WEBHOOK:pay_abc:5114915:SUCCESS"


def test_parse_failed_dropped_and_refund_events() -> None:
    failed = CfPayment(cf_payment_id=1, payment_status="FAILED", payment_amount=10)
    ev = parse_event(signed_webhook("PAYMENT_FAILED_WEBHOOK", "pay_a", payment=failed)[0])
    assert ev is not None and ev.kind == "payment_failed"
    dropped = CfPayment(cf_payment_id=2, payment_status="USER_DROPPED", payment_amount=10)
    ev = parse_event(signed_webhook("PAYMENT_USER_DROPPED_WEBHOOK", "pay_a", payment=dropped)[0])
    assert ev is not None and ev.kind == "payment_dropped"
    body, _ = signed_webhook(
        "REFUND_STATUS_WEBHOOK", "pay_a", refund={"refund_id": "rf_a", "cf_refund_id": 77, "refund_status": "SUCCESS"}
    )
    ev = parse_event(body)
    assert ev is not None and ev.kind == "refund_status"
    assert (ev.refund_id, ev.refund_status, ev.provider_refund_id) == ("rf_a", "succeeded", "77")
    assert ev.event_key == "REFUND_STATUS_WEBHOOK:pay_a:rf_a:SUCCESS"


def test_unknown_or_malformed_events_are_ignored() -> None:
    assert parse_event(b'{"type":"SETTLEMENT_WEBHOOK","data":{}}') is None
    assert parse_event(b"not json") is None
    assert parse_event(b"[]") is None
    assert parse_event(b'{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{}}}') is None


def test_redaction_strips_customer_details() -> None:
    body, _ = signed_webhook(
        "PAYMENT_SUCCESS_WEBHOOK",
        "pay_a",
        payment=CfPayment(cf_payment_id=1, payment_status="SUCCESS", payment_amount=1),
    )
    redacted = redact_payload(body)
    assert "customer_details" not in redacted["data"]
    assert redacted["data"]["order"]["order_id"] == "pay_a"
