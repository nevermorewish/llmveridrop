"""Anthropic long-context detector tests — mirrors OpenAI variant.

Both detectors share the same core/long_context.py primitives; tests here
focus on the protocol-specific surface (messages_create vs
chat_completions_create, content[].text vs choices[0].message.content,
input_tokens vs prompt_tokens) without re-testing the core helpers."""

from __future__ import annotations

import pytest

from relay_detector.core.long_context import ANSWER_RE
from relay_detector.core.models import ExecutionConfig, Mode
from relay_detector.protocols.anthropic.detectors.long_context import (
    LongContextDetector,
)


class _MockClient:
    def __init__(self, base_url: str = "https://mock.anthropic.example"):
        self.base_url = base_url
        self.calls: list[dict] = []
        self.messages_create = None  # set in tests


def _build_resp(text: str, input_tokens: int = 1000) -> dict:
    """Anthropic Messages API response shape: content blocks + usage."""
    return {
        "id": "msg_mock",
        "type": "message",
        "role": "assistant",
        "model": "claude-haiku-4-5",
        "stop_reason": "end_turn",
        "content": [{"type": "text", "text": text}],
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": 50,
        },
    }


@pytest.mark.asyncio
async def test_anthropic_long_context_skips_when_not_opted_in():
    det = LongContextDetector()
    det.config = ExecutionConfig.for_mode(Mode.FULL, include_long_context=False)
    client = _MockClient()
    client.messages_create = lambda **k: (_ for _ in ()).throw(
        AssertionError("should not call API when not opted in")
    )
    result = await det.run(client, "claude-haiku-4-5")
    assert result.status == "skip"
    assert "可选" in result.details["skip_reason"]


@pytest.mark.asyncio
async def test_anthropic_long_context_passes_when_all_needles_recalled():
    det = LongContextDetector()
    det.config = ExecutionConfig.for_mode(Mode.FULL, include_long_context=True)
    client = _MockClient()

    async def smart_response(**kwargs):
        # Extract canonical answers from the embedded prompt and echo them back
        prompt = kwargs["messages"][0]["content"]
        ids = ANSWER_RE.findall(prompt.upper())
        return ({}, _build_resp("\n".join(ids[:3])), {}, 0)

    client.messages_create = smart_response
    # claude-haiku-4-5 has 200k context — all three tiers probe.
    result = await det.run(client, "claude-haiku-4-5")
    assert result.status == "pass"
    assert result.score == 100.0
    tiers = result.details["tiers_tested"]
    assert len(tiers) == 3
    for t in tiers:
        assert t["status"] == "pass"
        assert t["needles_found"] == 3
    assert result.details["model_context_limit"] == 200_000


@pytest.mark.asyncio
async def test_anthropic_long_context_fails_at_first_tier_when_truncated():
    det = LongContextDetector()
    det.config = ExecutionConfig.for_mode(Mode.FULL, include_long_context=True)
    client = _MockClient()

    async def truncated_response(**kwargs):
        # Severe truncation: model can't see any needles
        return ({}, _build_resp("NOT FOUND\nNOT FOUND\nNOT FOUND"), {}, 0)

    client.messages_create = truncated_response
    result = await det.run(client, "claude-haiku-4-5")
    assert result.status == "fail"
    # Stop on first failure — only 32k tier probed
    assert len(result.details["tiers_tested"]) == 1
    assert result.details["tiers_tested"][0]["target_tokens"] == 32_000
    assert result.details["truncation_inferred_at_tokens"] is not None


@pytest.mark.asyncio
async def test_anthropic_long_context_request_error_treated_as_truncation():
    det = LongContextDetector()
    det.config = ExecutionConfig.for_mode(Mode.FULL, include_long_context=True)
    client = _MockClient()

    async def too_large(**kwargs):
        raise RuntimeError("413 Payload Too Large")

    client.messages_create = too_large
    result = await det.run(client, "claude-haiku-4-5")
    assert result.status == "fail"
    assert "413" in result.details["tiers_tested"][0]["error"]
    assert result.details["tiers_tested"][0]["estimated_cost_usd"] == 0.0


@pytest.mark.asyncio
async def test_anthropic_long_context_passes_haiku_with_200k_clamp():
    """200k tier on a 200k-context model must be probed (not skipped) by
    clamping the haystack to leave room for the question. Catches the bug
    where naive `target > limit` skips the highest tier on every Anthropic
    model and silently lowers Veridrop's coverage."""
    det = LongContextDetector()
    det.config = ExecutionConfig.for_mode(Mode.FULL, include_long_context=True)
    client = _MockClient()

    async def smart_response(**kwargs):
        prompt = kwargs["messages"][0]["content"]
        ids = ANSWER_RE.findall(prompt.upper())
        return ({}, _build_resp("\n".join(ids[:3])), {}, 0)

    client.messages_create = smart_response
    result = await det.run(client, "claude-sonnet-4-6")  # 200k context
    tiers = result.details["tiers_tested"]
    # No skip — all three tiers actually probed even though 200k tier ==
    # model limit.
    assert all(t["status"] == "pass" for t in tiers)
    assert tiers[2]["target_tokens"] == 200_000


@pytest.mark.asyncio
async def test_anthropic_long_context_uses_correct_api_shape():
    """Sanity check: detector calls messages_create (not chat_completions),
    sends max_tokens (not max_completion_tokens), and extracts content[].text."""
    det = LongContextDetector()
    det.config = ExecutionConfig.for_mode(Mode.FULL, include_long_context=True)
    client = _MockClient()

    captured_kwargs: list[dict] = []

    async def capture(**kwargs):
        captured_kwargs.append(kwargs)
        prompt = kwargs["messages"][0]["content"]
        ids = ANSWER_RE.findall(prompt.upper())
        return ({}, _build_resp("\n".join(ids[:3])), {}, 0)

    client.messages_create = capture
    await det.run(client, "claude-haiku-4-5")

    assert len(captured_kwargs) >= 1
    first = captured_kwargs[0]
    assert "max_tokens" in first
    assert "max_completion_tokens" not in first
    assert first["temperature"] == 0
    assert first["model"] == "claude-haiku-4-5"
    assert first["messages"][0]["role"] == "user"
