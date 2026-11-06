FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir .
COPY *.py ./
RUN useradd --uid 10001 --create-home app && mkdir /state && chown app /state
USER app
ENV PUBLISH_DATABASE=/state/published.sqlite PICK_DATABASE=/state/picks.sqlite
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
