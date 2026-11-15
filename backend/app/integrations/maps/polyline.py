"""Google encoded-polyline algorithm (precision 5). Used by the fake maps and by tests."""

from __future__ import annotations

from collections.abc import Iterable


def _encode_value(v: int) -> str:
    v = ~(v << 1) if v < 0 else v << 1
    out = []
    while v >= 0x20:
        out.append(chr((0x20 | (v & 0x1F)) + 63))
        v >>= 5
    out.append(chr(v + 63))
    return "".join(out)


def encode(points: Iterable[tuple[float, float]]) -> str:
    result: list[str] = []
    prev_lat = prev_lng = 0
    for lat, lng in points:
        ilat, ilng = round(lat * 1e5), round(lng * 1e5)
        result.append(_encode_value(ilat - prev_lat))
        result.append(_encode_value(ilng - prev_lng))
        prev_lat, prev_lng = ilat, ilng
    return "".join(result)


def decode(encoded: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    index = lat = lng = 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            shift = result = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lng += deltas[1]
        points.append((lat / 1e5, lng / 1e5))
    return points
