FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as an unprivileged user; the container binds only the high
# port 8000, so no special capabilities are needed.
RUN useradd --create-home --shell /usr/sbin/nologin --uid 10001 appuser \
    && mkdir -p uploads \
    && chown -R appuser:appuser /app \
    && chmod +x entrypoint.sh

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1

ENTRYPOINT ["./entrypoint.sh"]