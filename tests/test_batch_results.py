from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from web import jobs
from web.server import app


def test_batch_page_and_results_reuse_result_rows(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(jobs, "JOBS_DIR", tmp_path)
    report = {
        "protocol": "openai",
        "tier": "behavioral",
        "tier_title": "",
        "tier_message": "",
        "base_url": "https://relay.example.com/v1",
        "api_key_masked": "sk-...abcd",
        "target_model": "gpt-4o-mini",
        "mode": "standard",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_score": 88.0,
        "verdict": "passed",
        "summary": "ok",
        "performance": {
            "total_latency_ms": 119522,
            "ttft_ms": 1995,
            "request_count": 8,
            "backoff_events": 1,
            "usage": {"input_tokens": 1507067, "output_tokens": 1863},
        },
        "results": [
            {"name": "basic_request", "status": "pass", "score": 100.0},
            {"name": "token_billing", "status": "fail", "score": 40.0},
        ],
    }
    jobs.report_path("job123", "openai").write_text(
        json.dumps(report), encoding="utf-8"
    )

    client = TestClient(app)
    page = client.get("/batch?ids=job123")
    assert page.status_code == 200
    assert "20260526-deepseek" in page.text
    assert 'id="batch-share-btn"' in page.text
    assert "OpenAI 检测项各自检查什么?" in page.text

    resp = client.get("/api/batch/results?ids=job123")
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert item["status"] == "done"
    assert item["base_url"] == "https://relay.example.com/v1"
    assert item["log_url"] == "/logs/job123"
    assert item["log_text_url"] == "/api/logs/job123.txt"
    assert item["perf_benchmark"]["sample"] == "detector_run"
    assert item["perf_benchmark"]["request_count"] == 8
    assert item["perf_benchmark"]["backoff_events"] == 1
    assert item["perf_benchmark"]["avg_latency_ms_per_request"] == 119522 / 8
    labels = [row["label"] for row in item["rows"]]
    assert "基础请求" in labels
    assert "Token 计费" in labels
    assert all("basic_request" != label for label in labels)

    log_resp = client.get("/api/logs/job123.txt")
    assert log_resp.status_code == 200
    assert "legacy log synthesized from report job_id=job123" in log_resp.text
    assert "detector name=basic_request status=pass" in log_resp.text

    log_page = client.get("/logs/job123")
    assert log_page.status_code == 200
    assert "检测日志" in log_page.text
    assert "原始日志" in log_page.text


def test_batch_page_shows_claude_detector_explanations(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(jobs, "JOBS_DIR", tmp_path)
    report = {
        "protocol": "anthropic",
        "tier": "cryptographic",
        "base_url": "https://claude-relay.example.com",
        "api_key_masked": "sk-...abcd",
        "target_model": "claude-haiku-4-5",
        "mode": "full",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_score": 90.0,
        "verdict": "passed",
        "summary": "ok",
        "performance": {},
        "results": [
            {"name": "identity", "status": "pass", "score": 100.0},
            {"name": "long_context", "status": "skip", "score": 0.0},
        ],
    }
    jobs.report_path("claude123", "anthropic").write_text(
        json.dumps(report), encoding="utf-8"
    )

    client = TestClient(app)
    page = client.get("/batch?ids=claude123")
    assert page.status_code == 200
    assert "12 项检测各自检查什么?" in page.text
    assert "身份一致性 (Identity)" in page.text
    assert "长上下文真实性 (Long Context)" in page.text
def test_batch_static_js_contains_load_test_section():
    app_js = Path("web/static/app.js").read_text(encoding="utf-8")
    assert "压测结果对比" in app_js
    assert "renderBatchLoadMatrix" in app_js
    assert "avg_latency_ms_per_request" in app_js
