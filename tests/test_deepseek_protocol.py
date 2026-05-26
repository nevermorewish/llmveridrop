"""DeepSeek OpenAI-compatible protocol tests."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from relay_detector.core.models import ExecutionConfig, Mode
from relay_detector.protocols.deepseek import (
    build_detectors,
    default_base_url,
    default_model,
    model_choices,
    pick_default_model,
    tier_banner,
)
from relay_detector.protocols.deepseek.config import is_supported_model
from relay_detector.protocols.deepseek.detectors.streaming_usage import (
    StreamingUsageDetector,
)
from relay_detector.protocols.deepseek.runner import Runner


def _chat_payload(
    *,
    model: str = "deepseek-v4-pro",
    content: str = "pong",
    finish_reason: str = "stop",
    tool_calls: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    message: dict[str, Any] = {"role": "assistant", "content": content}
    if tool_calls is not None:
        message["content"] = None
        message["tool_calls"] = tool_calls
    return {
        "id": "chatcmpl-deepseek-test",
        "object": "chat.completion",
        "created": 1741569952,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 2,
            "total_tokens": 12,
        },
    }


class FakeDeepSeekClient:
    async def chat_completions_create(self, **body: Any):
        model = body["model"]
        if body.get("tools"):
            response = _chat_payload(
                model=model,
                finish_reason="tool_calls",
                tool_calls=[
                    {
                        "id": "call_deepseek",
                        "type": "function",
                        "function": {
                            "name": "get_current_weather",
                            "arguments": '{"city":"Boston, MA","unit":"celsius"}',
                        },
                    }
                ],
            )
        else:
            response = _chat_payload(model=model, content="pong")
        return body, response, httpx.Headers({"x-request-id": "req_deepseek"}), 12

    async def chat_completions_stream(self, **body: Any):
        yield {
            "id": "chatcmpl-deepseek-test",
            "object": "chat.completion.chunk",
            "created": 1741569952,
            "model": body["model"],
            "choices": [{"index": 0, "delta": {"content": "deepseek "}}],
        }, 5
        yield {
            "id": "chatcmpl-deepseek-test",
            "object": "chat.completion.chunk",
            "created": 1741569952,
            "model": body["model"],
            "choices": [{"index": 0, "delta": {"content": "stream ok"}}],
        }, 6
        if body.get("stream_options", {}).get("include_usage"):
            yield {
                "id": "chatcmpl-deepseek-test",
                "object": "chat.completion.chunk",
                "created": 1741569952,
                "model": body["model"],
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 3,
                    "total_tokens": 13,
                    "prompt_cache_hit_tokens": 2,
                    "prompt_cache_miss_tokens": 8,
                },
            }, 8
        else:
            yield {
                "id": "chatcmpl-deepseek-test",
                "object": "chat.completion.chunk",
                "created": 1741569952,
                "model": body["model"],
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }, 8
        yield {"_done": True}, 9


def test_deepseek_models_are_limited_to_v4_pro_and_flash():
    assert model_choices() == ["deepseek-v4-pro", "deepseek-v4-flash"]
    assert default_model() == "deepseek-v4-pro"
    assert pick_default_model(["deepseek-v4-flash", "deepseek-v4-pro"]) == "deepseek-v4-pro"
    assert is_supported_model("deepseek-v4-pro") is True
    assert is_supported_model("deepseek-v4-flash") is True
    assert is_supported_model("deepseek-v3") is False
    assert default_base_url() == "https://api.deepseek.com/v1"


def test_deepseek_tier_banner_mentions_protocol_scope():
    title, message = tier_banner()
    assert title == "DeepSeek 协议级验证"
    assert "deepseek-v4-pro / deepseek-v4-flash" in message
    assert "不提供加密级" in message


@pytest.mark.asyncio
async def test_deepseek_streaming_usage_detector_accepts_usage_and_cache_fields():
    result = await StreamingUsageDetector().run(FakeDeepSeekClient(), "deepseek-v4-pro")

    assert result.status == "pass"
    assert result.score == 100.0
    assert result.details["usage_ok"] is True
    assert result.details["done_seen"] is True
    assert result.details["cache_usage_fields"] == [
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
    ]


@pytest.mark.asyncio
async def test_deepseek_quick_runner_completes_with_fake_client():
    cfg = ExecutionConfig.for_mode(Mode.QUICK, max_concurrent=2)
    runner = Runner(FakeDeepSeekClient(), build_detectors(), cfg)
    outcome = await runner.run("deepseek-v4-pro")
    by_name = {result.name: result for result in outcome.results}

    assert by_name["basic_request"].status == "pass"
    assert by_name["sse_usage"].status == "pass"
    assert by_name["protocol"].status == "pass"
