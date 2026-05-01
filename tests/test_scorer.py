"""Unit tests for scorer."""

from __future__ import annotations

from relay_detector.models import DetectorResult
from relay_detector.scorer import compute_total, summary_text, verdict_for


def _r(name: str, score: float, weight: float, status: str = "pass") -> DetectorResult:
    return DetectorResult(
        name=name,
        display_name=name,
        status=status,  # type: ignore[arg-type]
        score=score,
        weight=weight,
    )


def test_compute_total_basic_weighted_average():
    results = [
        _r("a", 100, 5),
        _r("b", 50, 5),
    ]
    # (100*5 + 50*5) / 10 = 75
    assert compute_total(results) == 75.0


def test_compute_total_skipped_excluded_from_denominator():
    results = [
        _r("a", 100, 5),
        _r("b", 0, 95, status="skip"),
    ]
    # skip excluded -> just a -> 100
    assert compute_total(results) == 100.0


def test_compute_total_empty_returns_zero():
    assert compute_total([]) == 0.0
    assert compute_total([_r("a", 100, 5, status="skip")]) == 0.0


def test_compute_total_zero_weight_safe():
    assert compute_total([_r("a", 100, 0)]) == 0.0


def test_verdict_thresholds():
    assert verdict_for(100) == "passed"
    assert verdict_for(85) == "passed"
    assert verdict_for(70) == "passed"
    assert verdict_for(69.99) == "marginal"
    assert verdict_for(50) == "marginal"
    assert verdict_for(49.99) == "failed"
    assert verdict_for(0) == "failed"


def test_summary_text_buckets():
    assert summary_text(95, "passed") == "优秀"
    assert summary_text(80, "passed") == "通过"
    assert summary_text(60, "marginal") == "基本合格"
    assert summary_text(20, "failed") == "未达标"


def test_compute_total_treats_error_as_zero_weighted():
    """An 'error' status still has weight, so it pulls total down."""
    results = [
        _r("a", 100, 5),
        _r("b", 0, 5, status="error"),
    ]
    # error counts: (100*5 + 0*5)/10 = 50
    assert compute_total(results) == 50.0
