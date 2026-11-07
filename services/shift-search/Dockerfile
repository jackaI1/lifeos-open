FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 app
COPY *.py *.json *.sql ./
USER app
CMD ["sh", "-c", "python search.py && uvicorn search:app --host 0.0.0.0 --port 8000"]
