# Playwright base image ships Chromium + all system deps preinstalled.
FROM mcr.microsoft.com/playwright/python:v1.49.1-jammy

WORKDIR /app

# System libs OpenCV needs at runtime (headless wheel still wants libGL/glib).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Chromium is already present in the base image; ensure it's linked.
RUN playwright install chromium

COPY . .

ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app
EXPOSE 8000

RUN chmod +x entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
