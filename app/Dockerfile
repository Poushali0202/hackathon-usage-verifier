# Build from the PROJECT ROOT (hackathon-usage-verifier), not from app/:
#   docker build -f app/Dockerfile -t rr-verifier .
FROM python:3.11-slim

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/srv

COPY app/requirements.txt /srv/app/requirements.txt
RUN pip install --no-cache-dir -r /srv/app/requirements.txt

# the app imports run_batch and loads verify_usage.pipe from the project root
COPY run_batch.py verify_usage.pipe verify_github.pipe /srv/
COPY app /srv/app

EXPOSE 8000
# Render/hosts inject $PORT; default to 8000 locally
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
