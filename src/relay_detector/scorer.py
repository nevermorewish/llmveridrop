"""Weighted score aggregation — see DESIGN.md §5."""

from __future__ import annotations

from collections.abc import Iterable

from .models import DetectorResult, Verdict


# DESIGN.md §5.3
def verdict_for(score: float) -> Verdict:
    if score >= 70.0:
        return "passed"
    if score >= 50.0:
        return "marginal"
    return "failed"


def summary_text(score: float, verdict: Verdict) -> str:
    if verdict == "passed" and score >= 85.0:
        return "优秀"
    if verdict == "passed":
        return "通过"
    if verdict == "marginal":
        return "基本合格"
    return "未达标"


def compute_total(results: Iterable[DetectorResult]) -> float:
    """Weighted average over results that are not skipped.

    Per DESIGN.md §5.2:
        effective_weight = Σ d.weight for d.status != "skip"
        total = Σ (d.score × d.weight) / effective_weight
    """
    valid = [r for r in results if r.status != "skip"]
    if not valid:
        return 0.0
    weight_sum = sum(r.weight for r in valid)
    if weight_sum <= 0:
        return 0.0
    weighted = sum(r.score * r.weight for r in valid)
    return weighted / weight_sum
