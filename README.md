# Agentic AI Business Intelligence Platform

Agentic BI is a web application for asking business questions about retail sales data. It combines fixed, read-only analytics, MCP tools, document retrieval, machine-learning diagnostics, and optional LLM-generated narrative insights.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL with pgvector
- Model Context Protocol (MCP): MCP SDK with stdio client/server transports
- Retrieval: LangChain embeddings and pgvector-backed document search
- Narrative generation: Gemini, Groq, or OpenAI-compatible provider
- Diagnostics: Python-based machine-learning service

## Project structure

- `frontend/` – React dashboard and user interface
- `backend/` – Express API and orchestration layer
- `backend/src/mcp/` – MCP host plus SQL analytics and vector-search servers
- `database/` – SQL seed scripts and dataset utilities
- `docs/` – architecture notes and deployment documentation
- `docker-compose.production.yml` – production-oriented local deployment stack

## MCP architecture

The backend starts two local MCP servers over stdio and connects to them with MCP clients:

- **SQL analytics server** – exposes fixed tools for top products, top products in the latest month, revenue by country, top customers, and monthly revenue. Queries run in read-only PostgreSQL transactions; user questions are mapped to supported tools instead of being executed as arbitrary generated SQL.
- **Vector search server** – exposes `search_public_knowledge` to retrieve relevant licensed retail-context documents using Gemini embeddings and PostgreSQL pgvector. Returned documents include attribution and license metadata for citations.

The Express orchestration layer calls these MCP tools while assembling each answer. MCP is an internal service integration; the application does not require a separately installed MCP host.

## Local development

```bash
npm install
npm run dev
```

This starts the backend and frontend concurrently.

The backend also requires a PostgreSQL database. Configure `DATABASE_URL` in `backend/.env` and initialize/import the project data as described in [database/data/README.md](database/data/README.md).

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

Gemini embeddings for RAG use `GEMINI_API_KEY` independently of the narrative provider. If the selected narrative provider is unavailable or not configured, the app falls back to local deterministic orchestration.

## Data

The analytics layer uses the UCI Online Retail invoice-line dataset. Revenue is calculated from quantity multiplied by unit price; cancellation and return lines remain in the data and contribute negative revenue. See [database/data/README.md](database/data/README.md) for source, attribution, license, and import instructions.

## Default ports

- Frontend: http://localhost:5173
- Backend: http://localhost:5001

## Tests

Run the backend test suite with:

```bash
npm --prefix backend test
```

## Production deployment

See [docs/deployment-production.md](docs/deployment-production.md) for the AWS deployment design, environment variables, and production rollout sequence.
