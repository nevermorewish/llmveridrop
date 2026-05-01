"""Raw OpenAI HTTP client.

This intentionally avoids the official SDK so relay tests can inspect the
wire response exactly as it was returned by the target endpoint.
"""

from __future__ import annotations

import time
from typing import Any

import httpx


DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_TIMEOUT = 30.0


class OpenAIAPIError(Exception):
    """Raised on non-2xx HTTP response. Holds status + body for inspection."""

    def __init__(self, status: int, body: str, headers: httpx.Headers | None = None):
        self.status = status
        self.body = body
        self.headers = headers
        super().__init__(f"HTTP {status}: {body[:200]}")


class OpenAIClient:
    """Raw httpx-based client for OpenAI-compatible endpoints."""

    def __init__(
        self,
        base_url: str = DEFAULT_OPENAI_BASE_URL,
        api_key: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        extra_headers: dict[str, str] | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or ""
        headers = {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
        }
        if extra_headers:
            headers.update(extra_headers)
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=timeout,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "OpenAIClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def responses_create(
        self, **body: Any
    ) -> tuple[dict[str, Any], dict[str, Any], httpx.Headers, int]:
        """Non-streaming POST /responses."""

        body.pop("stream", None)
        start = time.perf_counter()
        resp = await self._client.post("/responses", json=body)
        latency_ms = int((time.perf_counter() - start) * 1000)
        if resp.status_code >= 400:
            raise OpenAIAPIError(resp.status_code, resp.text, resp.headers)
        return body, resp.json(), resp.headers, latency_ms

    async def chat_completions_create(
        self, **body: Any
    ) -> tuple[dict[str, Any], dict[str, Any], httpx.Headers, int]:
        """Non-streaming POST /chat/completions."""

        body.pop("stream", None)
        start = time.perf_counter()
        resp = await self._client.post("/chat/completions", json=body)
        latency_ms = int((time.perf_counter() - start) * 1000)
        if resp.status_code >= 400:
            raise OpenAIAPIError(resp.status_code, resp.text, resp.headers)
        return body, resp.json(), resp.headers, latency_ms
