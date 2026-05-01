"""Job queue for HTTP-driven detections.

Wraps the same Runner the CLI uses. Single uvicorn worker, in-process state
guarded by an asyncio lock. Done jobs are persisted to disk so a server
restart keeps the shareable result URLs alive. API keys are NEVER persisted —
the masked form goes to disk; the raw key lives only in the Job until the run
finishes, then is dropped from memory.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from relay_detector.client import AnthropicClient
from relay_detector.detectors import build_all
from relay_detector.models import (
    DetectionReport,
    ExecutionConfig,
    Mode,
    mask_api_key,
)
from relay_detector.runner import Runner
from relay_detector.scorer import compute_total, summary_text, verdict_for


JobStatus = Literal["queued", "running", "done", "error"]

JOBS_DIR = Path("/opt/veridrop/web_data/jobs")
JOBS_DIR.mkdir(parents=True, exist_ok=True)

# Cap concurrent detections so a flood of submissions doesn't exhaust file
# descriptors or get the upstream Anthropic API rate-limited. Each detection
# already runs ~13 outbound requests in parallel, so 6 inflight = ~78 sockets.
_MAX_INFLIGHT = 6
_SEMA = asyncio.Semaphore(_MAX_INFLIGHT)


@dataclass
class Job:
    id: str
    status: JobStatus = "queued"
    base_url: str = ""
    target_model: str = ""
    mode: str = "full"
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    report: dict[str, Any] | None = None
    error: str | None = None


_JOBS: dict[str, Job] = {}
_LOCK = asyncio.Lock()


def _new_job_id() -> str:
    # 8-char URL-safe id; secrets gives ~48 bits of entropy, fine for an
    # unguessable shareable link without auth.
    return secrets.token_urlsafe(6)


async def submit(base_url: str, api_key: str, model: str, mode: str) -> str:
    """Queue a detection job and return the job id immediately."""
    job_id = _new_job_id()
    job = Job(id=job_id, base_url=base_url, target_model=model, mode=mode)
    async with _LOCK:
        _JOBS[job_id] = job
    # fire-and-forget; the asyncio task lives until the runner finishes.
    asyncio.create_task(_run(job_id, base_url, api_key, model, mode))
    return job_id


async def get(job_id: str) -> Job | None:
    """Look up a job by id. Falls back to disk for jobs that survived a restart."""
    async with _LOCK:
        j = _JOBS.get(job_id)
    if j is not None:
        return j
    path = JOBS_DIR / f"{job_id}.json"
    if not path.exists():
        return None
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return Job(
        id=job_id,
        status="done",
        base_url=report.get("base_url", ""),
        target_model=report.get("target_model", ""),
        mode=report.get("mode", "full"),
        created_at=time.time(),
        finished_at=time.time(),
        report=report,
    )


async def _run(
    job_id: str, base_url: str, api_key: str, model: str, mode: str
) -> None:
    async with _SEMA:
        async with _LOCK:
            j = _JOBS.get(job_id)
            if j is None:
                return
            j.status = "running"
            j.started_at = time.time()

        try:
            cfg = ExecutionConfig.for_mode(Mode(mode), max_concurrent=3)
            async with AnthropicClient(
                base_url, api_key, timeout=cfg.request_timeout_s
            ) as client:
                runner = Runner(client, build_all(), cfg)
                outcome = await runner.run(model)

            score = compute_total(outcome.results)
            verdict = verdict_for(score)
            summary = summary_text(score, verdict)

            self_id: str | None = None
            brands: list[str] = []
            for r in outcome.results:
                if r.name != "identity" or not isinstance(r.details, dict):
                    continue
                text = r.details.get("response_text")
                if isinstance(text, str) and text.strip():
                    self_id = text.strip()
                b = r.details.get("detected_non_anthropic_brands")
                if isinstance(b, list):
                    brands = [x for x in b if isinstance(x, str)]
                break

            report = DetectionReport(
                base_url=base_url,
                api_key_masked=mask_api_key(api_key),
                target_model=model,
                mode=Mode(mode),
                timestamp=datetime.now(timezone.utc),
                total_score=score,
                verdict=verdict,
                results=outcome.results,
                performance=outcome.performance,
                summary=summary,
                self_reported_identity=self_id,
                detected_non_anthropic_brands=brands,
            )
            report_dict = json.loads(report.model_dump_json())
            (JOBS_DIR / f"{job_id}.json").write_text(
                json.dumps(report_dict, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            async with _LOCK:
                if job_id in _JOBS:
                    _JOBS[job_id].status = "done"
                    _JOBS[job_id].report = report_dict
                    _JOBS[job_id].finished_at = time.time()

        except Exception as e:  # noqa: BLE001 — bubble error into job state
            async with _LOCK:
                if job_id in _JOBS:
                    _JOBS[job_id].status = "error"
                    _JOBS[job_id].error = f"{type(e).__name__}: {e}"
                    _JOBS[job_id].finished_at = time.time()
