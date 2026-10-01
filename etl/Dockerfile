FROM python:3.13-slim

WORKDIR /app

COPY etl/requirements.txt /app/etl/requirements.txt
RUN pip install --no-cache-dir -r /app/etl/requirements.txt

COPY etl /app/etl

ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["python", "-m", "etl.pipeline"]
