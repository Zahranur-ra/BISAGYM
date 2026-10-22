SHELL := /bin/sh
.DEFAULT_GOAL := help

PYTHON ?= python
API_DIR := apps/api
WEB_DIR := apps/web
LOCAL_DATABASE_URL ?= sqlite:///./gym.db

.PHONY: help install dev test lint format migrate seed reset-db e2e docker-up docker-down

help:
	@printf '%s\n' \
	  'install      Install API and web dependencies' \
	  'dev          Run API and web locally with SQLite' \
	  'test         Run backend and frontend tests' \
	  'lint         Run configured linters' \
	  'format       Run configured formatters' \
	  'migrate      Apply local database migrations' \
	  'seed         Load development seed data' \
	  'reset-db     Recreate the local SQLite database' \
	  'e2e          Run the frontend end-to-end script' \
	  'docker-up    Build and start the Compose stack' \
	  'docker-down  Stop the Compose stack'

install:
	@if [ -f "$(API_DIR)/requirements.txt" ]; then \
	  cd "$(API_DIR)" && $(PYTHON) -m pip install -r requirements.txt; \
	elif [ -f "$(API_DIR)/pyproject.toml" ]; then \
	  cd "$(API_DIR)" && $(PYTHON) -m pip install -e '.[dev]'; \
	else \
	  echo "API dependency manifest not found" >&2; exit 1; \
	fi
	@cd "$(WEB_DIR)" && npm install

dev:
	@(cd "$(API_DIR)" && DATABASE_URL="$(LOCAL_DATABASE_URL)" $(PYTHON) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) & api_pid=$$!; \
	(cd "$(WEB_DIR)" && npm run dev -- --host 0.0.0.0 --port 5173) & web_pid=$$!; \
	trap 'kill $$api_pid $$web_pid 2>/dev/null || true' INT TERM EXIT; \
	wait

test:
	@cd "$(API_DIR)" && $(PYTHON) -m pytest
	@cd "$(WEB_DIR)" && npm test

lint:
	@cd "$(API_DIR)" && $(PYTHON) -m ruff check .
	@cd "$(WEB_DIR)" && npm run lint

format:
	@cd "$(API_DIR)" && $(PYTHON) -m ruff format .
	@cd "$(WEB_DIR)" && npm exec -- eslint . --fix

migrate:
	@cd "$(API_DIR)" && DATABASE_URL="$(LOCAL_DATABASE_URL)" $(PYTHON) -m alembic upgrade head

seed:
	@cd "$(API_DIR)" && DATABASE_URL="$(LOCAL_DATABASE_URL)" $(PYTHON) -m app.seed

reset-db:
	@rm -f "$(API_DIR)/gym.db" "$(API_DIR)/gym.db-shm" "$(API_DIR)/gym.db-wal"
	@$(MAKE) migrate
	@$(MAKE) seed

e2e:
	@cd "$(WEB_DIR)" && node -e "const p=require('./package.json'); if(!p.scripts?.e2e){console.error('Frontend e2e script is not configured yet'); process.exit(1)}"
	@cd "$(WEB_DIR)" && npm run e2e

docker-up:
	@docker compose up --build

docker-down:
	@docker compose down
