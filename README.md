# Agentic AI Business Intelligence Platform

This repository contains the initial MVP structure for the Agentic AI Business Intelligence Platform described in the project planning documents.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL (planned for the MVP database layer)
- AI layer: LLM + SQL Agent + RAG + ML service (planned in subsequent phases)

## Project structure

- `frontend/` – React dashboard and user interface
- `backend/` – Express API and orchestration layer
- `database/` – SQL seed scripts and dataset utilities
- `docs/` – architecture notes and deployment documentation
- `docker-compose.production.yml` – production-oriented local deployment stack

## Local development

```bash
npm install
npm run dev
```

This starts the backend and frontend concurrently.

## Real LLM configuration

Copy the backend example environment file and add your provider credentials:

```bash
cp backend/.env.example backend/.env
```

Then set the real values for:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL` (optional for OpenAI-compatible providers)

When the API key is present, the app automatically switches from the local deterministic orchestration mode into the real-model path. Without it, the app remains in the fallback deterministic workflow.

## Default ports

- Frontend: http://localhost:5173
- Backend: http://localhost:5001

## Production deployment

See [docs/deployment-production.md](docs/deployment-production.md) for the AWS deployment design, environment variables, and production rollout sequence.

## Notes

This is the foundational MVP scaffold. It provides:

- a working frontend UI
- a ready Express API
- a project structure that matches the weekend plan
- a clean extension path for SQL, RAG, and ML work
- a production deployment path for containerized cloud rollout
