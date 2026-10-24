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

For Gemini narratives and Gemini embeddings, set:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`

To use Groq for narrative generation while keeping Gemini for embeddings and RAG, set:

- `LLM_PROVIDER=groq`
- `GROQ_API_KEY`
- `GROQ_MODEL` (defaults to `openai/gpt-oss-20b`)

Groq uses its OpenAI-compatible chat completions endpoint. OpenAI-compatible providers can also be configured with `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_BASE_URL`.

Without a key for the selected narrative provider, the app uses local deterministic orchestration. Gemini embeddings continue to use `GEMINI_API_KEY` independently of the narrative provider.

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
