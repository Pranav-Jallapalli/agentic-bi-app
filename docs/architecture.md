# Architecture Overview

## Components

- React + Vite frontend. Existing dashboard response fields remain stable; retrieved documents carry source and license information for citations.
- Express backend acts as the MCP host and coordinates business-question handling.
- PostgreSQL stores the UCI Online Retail invoice-line records and LangChain PGVectorStore embeddings.
- LangChain.js splits attributed source documents, creates Gemini embeddings, retrieves similar chunks from pgvector, and supplies them as grounding context.
- Python analytics remains a separate deterministic heuristic service; it is not a trained ML model and is independent of document retrieval.

## MCP Topology

The backend MCP host starts two local child processes over stdio:

1. SQL MCP server exposes fixed, read-only tools for top products, countries, customers, and monthly net revenue. It executes parameterized SQL in read-only transactions.
2. Vector MCP server exposes semantic search over public-source and preserved user documents through LangChain PGVectorStore.

The host uses an MCP client for each server, calls the appropriate SQL tool and vector search, and combines the results for the existing BI response and optional LLM narrative. MCP provides tool transport and discovery; the host owns the overall RAG orchestration.

## Data and Provenance

`database/data/online-retail.zip` is the primary analytics dataset. The repeatable streaming importer writes invoice lines to `retail_transactions`, preserves cancellation rows and nullable customer IDs, and records source checksum and CC BY 4.0 attribution. `backend/data/public-knowledge.json` contains attributed UCI and ONS context. `backend/data/documents.json` remains for user-provided documents and is not replaced by the public corpus.

## Local Runtime

Docker Compose uses PostgreSQL 16 with pgvector enabled. Run the importer with `npm --workspace=backend run data:import` after PostgreSQL is available. Set `GEMINI_API_KEY` for embeddings and run `npm --workspace=backend run rag:index` to index the knowledge corpus. The application can start without Gemini configured, but semantic retrieval requires the key and a populated pgvector index.

AWS services remain paused. Cloud changes are deferred until local importer, RAG, MCP, and API integration tests pass and expected costs are reviewed.
