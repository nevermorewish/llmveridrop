"""DeepSeek detector config."""

from __future__ import annotations

from ...core.models import Mode


DETECTOR_WEIGHTS: dict[str, float] = {
    "basic_request": 15.0,
    "model_consistency": 10.0,
    "protocol": 15.0,
    "sse_usage": 20.0,
    "function_calling": 20.0,
    "long_context": 20.0,
}


MODE_DETECTORS: dict[Mode, set[str]] = {
    Mode.QUICK: {
        "basic_request",
        "protocol",
        "sse_usage",
    },
    Mode.STANDARD: {
        "basic_request",
        "model_consistency",
        "protocol",
        "sse_usage",
        "function_calling",
    },
    Mode.FULL: set(DETECTOR_WEIGHTS.keys()),
}


DEEPSEEK_MODEL_CHOICES = [
    "deepseek-v4-pro",
    "deepseek-v4-flash",
]


def is_supported_model(model: str) -> bool:
    return model in DEEPSEEK_MODEL_CHOICES


def models_match(request_model: str, response_model: str) -> bool:
    if not request_model or not response_model:
        return False
    a = request_model.removeprefix("models/").replace("_", "-")
    b = response_model.removeprefix("models/").replace("_", "-")
    return a == b or a.startswith(b) or b.startswith(a)
