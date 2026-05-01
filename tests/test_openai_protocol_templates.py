"""Tests for the first OpenAI protocol templates."""

from __future__ import annotations

from relay_detector.openai.protocol_templates import (
    validate_chat_completion,
    validate_openai_payload,
    validate_responses_api,
)


def _responses_payload(**overrides):
    payload = {
        "id": "resp_1234567890abcdef",
        "object": "response",
        "created_at": 1721596428,
        "status": "completed",
        "model": "gpt-4o-2024-08-06",
        "output": [
            {
                "id": "msg_1234567890",
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": "pong",
                    }
                ],
            }
        ],
        "usage": {
            "input_tokens": 10,
            "output_tokens": 2,
            "total_tokens": 12,
            "output_tokens_details": {"reasoning_tokens": 0},
        },
    }
    payload.update(overrides)
    return payload


def _chat_payload(**overrides):
    payload = {
        "id": "chatcmpl-abc123",
        "object": "chat.completion",
        "created": 1721596428,
        "model": "gpt-4o-2024-08-06",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "pong",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 2,
            "total_tokens": 12,
            "completion_tokens_details": {
                "reasoning_tokens": 0,
                "accepted_prediction_tokens": 0,
                "rejected_prediction_tokens": 0,
            },
        },
        "system_fingerprint": "fp_3407719c7f",
    }
    payload.update(overrides)
    return payload


def test_responses_api_template_accepts_official_shape():
    result = validate_responses_api(_responses_payload(), request_model="gpt-4o")
    assert result.passed is True
    assert result.score == 100.0
    assert result.issues == []
    assert result.fingerprints["id_prefix"] == "resp_"
    assert result.fingerprints["content_types"] == ["output_text"]


def test_responses_api_template_rejects_claude_message_shape():
    claude_like = {
        "id": "msg_01abc",
        "type": "message",
        "role": "assistant",
        "model": "claude-haiku-4-5",
        "content": [{"type": "text", "text": "pong"}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }
    result = validate_openai_payload("responses", claude_like, request_model="gpt-4o")
    assert result.passed is False
    codes = {issue.code for issue in result.issues}
    assert "id_prefix_invalid" in codes
    assert "object_invalid" in codes
    assert "top_level_missing" in codes


def test_responses_api_template_validates_function_call_arguments():
    payload = _responses_payload(
        output=[
            {
                "id": "fc_123",
                "type": "function_call",
                "call_id": "call_abc",
                "name": "get_weather",
                "arguments": "{\"city\":\"Tokyo\"}",
            }
        ]
    )
    result = validate_responses_api(payload)
    assert result.passed is True


def test_responses_api_template_flags_bad_function_call_arguments():
    payload = _responses_payload(
        output=[
            {
                "id": "fc_123",
                "type": "function_call",
                "call_id": "tool_1",
                "name": "get_weather",
                "arguments": "{city: Tokyo}",
            }
        ]
    )
    result = validate_responses_api(payload)
    codes = {issue.code for issue in result.issues}
    assert "function_call_id_prefix_invalid" in codes
    assert "json_arguments_invalid" in codes


def test_chat_completion_template_accepts_official_shape():
    result = validate_chat_completion(_chat_payload(), request_model="gpt-4o")
    assert result.passed is True
    assert result.score == 100.0
    assert result.fingerprints["id_prefix"] == "chatcmpl-"
    assert result.fingerprints["system_fingerprint_present"] is True


def test_chat_completion_template_validates_tool_calls():
    payload = _chat_payload(
        choices=[
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_abc123",
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "arguments": "{\"location\":\"Paris\"}",
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ]
    )
    result = validate_chat_completion(payload)
    assert result.passed is True
    assert result.fingerprints["tool_call_id_prefixes"] == ["call_"]


def test_chat_completion_template_flags_uuid_and_bad_tool_id():
    payload = _chat_payload(
        id="0b68fbd0-91e5-4aa6-a715-e206d8daae1c",
        choices=[
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "tool_1",
                            "type": "function",
                            "function": {
                                "name": "get_weather",
                                "arguments": "{\"location\":\"Paris\"}",
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
    )
    result = validate_chat_completion(payload)
    assert result.passed is False
    codes = {issue.code for issue in result.issues}
    assert "id_prefix_invalid" in codes


def test_chat_completion_template_flags_usage_total_mismatch():
    payload = _chat_payload(
        usage={
            "prompt_tokens": 10,
            "completion_tokens": 2,
            "total_tokens": 99,
        }
    )
    result = validate_chat_completion(payload)
    assert result.score == 95.0
    assert any(issue.code == "usage_total_mismatch" for issue in result.issues)
