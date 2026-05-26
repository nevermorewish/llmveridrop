"""DeepSeek OpenAI-compatible Chat Completions client."""

from __future__ import annotations

from ..openai.client import (
    OpenAIAPIError as DeepSeekAPIError,
    OpenAIChatClient,
    ThrottledOpenAIClient,
    normalize_openai_base_url,
)

DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"


class DeepSeekClient(OpenAIChatClient):
    def __init__(
        self,
        base_url: str = DEFAULT_DEEPSEEK_BASE_URL,
        api_key: str | None = None,
        timeout: float = 30.0,
        extra_headers: dict[str, str] | None = None,
    ):
        super().__init__(
            normalize_openai_base_url(base_url),
            api_key,
            timeout=timeout,
            extra_headers=extra_headers,
        )


ThrottledDeepSeekClient = ThrottledOpenAIClient
