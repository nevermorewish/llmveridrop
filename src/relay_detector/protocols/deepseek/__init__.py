"""DeepSeek OpenAI-compatible protocol implementation."""

from __future__ import annotations

from pathlib import Path

from ...core.detectors_base import BaseDetector
from ...core.models import DetectionTier, ExecutionConfig, Mode, Protocol
from .client import DEFAULT_DEEPSEEK_BASE_URL, DeepSeekClient
from .config import DEEPSEEK_MODEL_CHOICES
from .detectors import build_all
from .runner import Runner

PROTOCOL_NAME = Protocol.DEEPSEEK
TIER = DetectionTier.PROTOCOL


def model_choices() -> list[str]:
    return list(DEEPSEEK_MODEL_CHOICES)


def default_model() -> str:
    return DEEPSEEK_MODEL_CHOICES[0]


_PREFERRED_DEFAULTS = (
    "deepseek-v4-pro",
    "deepseek-v4-flash",
)


def pick_default_model(available: list[str]) -> str | None:
    if not available:
        return None
    for pref in _PREFERRED_DEFAULTS:
        for model in available:
            bare = model.removeprefix("models/")
            if bare == pref or bare.startswith(pref + "-"):
                return model
    return available[0]


def default_base_url() -> str:
    return DEFAULT_DEEPSEEK_BASE_URL


def build_config(mode: Mode, max_concurrent: int = 3) -> ExecutionConfig:
    return ExecutionConfig.for_mode(mode, max_concurrent=max_concurrent)


def build_detectors(mode: Mode | None = None) -> list[BaseDetector]:
    _ = mode
    return build_all()


def make_client(base_url: str, api_key: str, timeout: float) -> DeepSeekClient:
    return DeepSeekClient(base_url, api_key, timeout=timeout)


def build_runner(
    client: DeepSeekClient,
    detectors: list[BaseDetector],
    config: ExecutionConfig,
) -> Runner:
    return Runner(client, detectors, config)


def baseline_path(model_id: str, mode: Mode) -> Path | None:
    _ = model_id, mode
    return None


def verdict_caption(score: float) -> str:
    if score >= 85:
        return "协议表现良好"
    if score >= 70:
        return "基本通过"
    if score >= 50:
        return "存在风险"
    return "未达标"


def tier_banner() -> tuple[str, str]:
    return (
        "DeepSeek 协议级验证",
        (
            "本检测通过 OpenAI 兼容协议验证 deepseek-v4-pro / deepseek-v4-flash "
            "中转站的 Chat Completions、SSE、usage、tool_calls 和上下文窗口表现。"
            "它不提供加密级模型真伪证明。"
        ),
    )
