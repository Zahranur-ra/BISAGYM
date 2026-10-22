FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY apps/api/ /app/
RUN if [ -f requirements.txt ]; then \
      python -m pip install --upgrade pip && python -m pip install -r requirements.txt; \
    elif [ -f pyproject.toml ]; then \
      python -m pip install --upgrade pip && python -m pip install .; \
    else \
      echo "apps/api must provide requirements.txt or pyproject.toml" >&2; exit 1; \
    fi
RUN python -m app.download_models

COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint
RUN chmod +x /usr/local/bin/api-entrypoint

EXPOSE 8000
ENTRYPOINT ["api-entrypoint"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
