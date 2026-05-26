"""DeepSeek SSE and streaming usage detector."""

from __future__ import annotations

from typing import Any

from ....core.models import DetectorResult
from relay_detector.protocols.openai.detectors.base import ActiveDetector


class StreamingUsageDetector(ActiveDetector):
    name = "sse_usage"
    display_name = "SSE / usage"
    weight = 20.0

    async def run(self, client, model: str) -> DetectorResult:
        chunks: list[dict[str, Any]] = []
        text_parts: list[str] = []
        usage: dict[str, Any] | None = None
        finish_reason: str | None = None
        parse_errors = 0
        done_seen = False
        try:
            async for chunk, _elapsed_ms in client.chat_completions_stream(
                model=model,
                max_completion_tokens=48,
                temperature=0,
                messages=[
                    {
                        "role": "user",
                        "content": "Reply only with: deepseek stream ok",
                    }
                ],
                stream_options={"include_usage": True},
            ):
                chunks.append(chunk)
                if chunk.get("_done"):
                    done_seen = True
                    continue
                if chunk.get("_parse_error"):
                    parse_errors += 1
                    continue
                if isinstance(chunk.get("usage"), dict):
                    usage = chunk["usage"]
                choices = chunk.get("choices")
                if not isinstance(choices, list):
                    continue
                for choice in choices:
                    if not isinstance(choice, dict):
                        continue
                    if choice.get("finish_reason") is not None:
                        finish_reason = choice.get("finish_reason")
                    delta = choice.get("delta")
                    if not isinstance(delta, dict):
                        continue
                    content = delta.get("content")
                    if isinstance(content, str):
                        text_parts.append(content)
        except Exception as e:  # noqa: BLE001
            return self._result("error", 0.0, error=str(e))

        text = "".join(text_parts).strip()
        usage_ok = _usage_ok(usage)
        cache_fields = _cache_fields(usage)
        score = 0.0
        if chunks:
            score += 15.0
        if parse_errors == 0:
            score += 15.0
        if text:
            score += 15.0
        if finish_reason in ("stop", "length", "tool_calls", None):
            score += 10.0
        if usage_ok:
            score += 30.0
        if cache_fields:
            score += 10.0
        if done_seen:
            score += 5.0

        details = {
            "chunk_count": len(chunks),
            "parse_errors": parse_errors,
            "done_seen": done_seen,
            "text_preview": text[:200],
            "finish_reason": finish_reason,
            "usage": usage,
            "usage_ok": usage_ok,
            "cache_usage_fields": cache_fields,
            "stream_options_include_usage": True,
        }
        return self._result("pass" if score >= 70 else "fail", score, details)


def _usage_ok(usage: dict[str, Any] | None) -> bool:
    if not isinstance(usage, dict):
        return False
    prompt = _int(usage.get("prompt_tokens"))
    completion = _int(usage.get("completion_tokens"))
    total = _int(usage.get("total_tokens"))
    if prompt is None or completion is None or total is None:
        return False
    return total >= prompt + completion


def _cache_fields(usage: dict[str, Any] | None) -> list[str]:
    if not isinstance(usage, dict):
        return []
    names = (
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
        "cache_hit_tokens",
        "cache_miss_tokens",
    )
    return [name for name in names if isinstance(usage.get(name), int)]


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None
