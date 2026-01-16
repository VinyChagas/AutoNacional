FROM mcr.microsoft.com/playwright/python:v1.57.0-jammy

WORKDIR /app

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

RUN mkdir -p /app/db \
    /app/certificados_armazenados \
    /app/downloads \
    /app/logs \
    /app/temp

EXPOSE 8000

CMD ["python", "run_server.py"]
