FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    VERIDROP_JOBS_DIR=/opt/veridrop/web_data/jobs \
    VERIDROP_WISHLIST_PATH=/opt/veridrop/web_data/wishlist.txt

WORKDIR /opt/veridrop

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md LICENSE ./
COPY src ./src
COPY web ./web
COPY data ./data

RUN python -m pip install --upgrade pip \
    && pip install ".[web]" \
    && mkdir -p /opt/veridrop/web_data/jobs \
    && useradd --create-home --shell /usr/sbin/nologin veridrop \
    && chown -R veridrop:veridrop /opt/veridrop

USER veridrop

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/ >/dev/null || exit 1

CMD ["python", "-m", "uvicorn", "web.server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
