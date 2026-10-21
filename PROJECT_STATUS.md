# Project Status

## Last updated
2026-10-21

## Current project status (2026-10-21)

The core application and AWS deployment are operational. The private, encrypted replacement RDS database contains the imported UCI Online Retail dataset and indexed RAG corpus. Backend and frontend ECS services each run one task, and production health, search, and analytics smoke tests have passed. The original RDS instance remains stopped and preserved.

The local production-style Compose stack is also running: the frontend is available at `http://localhost:80/`, the backend at `http://localhost:5001/`, and PostgreSQL uses the pgvector image. The backend `/api/health` endpoint returns HTTP 200 with the database connected.

### Verified progress
- Downloaded `database/data/online-retail.zip` from the UCI Machine Learning Repository. The source page identifies 541,909 records and a CC BY 4.0 license; attribution is recorded in `database/data/README.md`.
- Streaming importer added at `backend/scripts/import-retail-data.js`. Its dry run parsed all 541,909 records, including 9,288 cancellation invoices and 135,080 rows with missing customer IDs.
- Imported all 541,909 retail rows into the local `retail_transactions` table; verified 9,288 cancellations and 135,080 missing customer IDs.
- PostgreSQL schema and analytics queries are being migrated to invoice-line records in `retail_transactions`; synthetic sales inserts have been removed from the production schema.
- LangChain.js dependencies and implementation are in place for document splitting, Gemini embeddings, and PGVectorStore. The public corpus contains UCI dataset guidance and an attributed ONS retail bulletin. Existing handwritten documents are preserved and included as user-provided context.
- Indexed the five-document knowledge corpus with Gemini; verified six chunks and five ingestion records in PostgreSQL.
- Separate stdio MCP servers expose four fixed, read-only analytics tools and one vector-search tool. The backend MCP host launches one client for each server.
- Verified the local RAG corpus loads and splits five documents into six chunks; verified both MCP servers start and publish their expected tool names.
- Both Docker Compose manifests validate with the pgvector PostgreSQL image and health checks.
- Backend unit tests: 5 passed, 0 failed. The rebuilt frontend production image built successfully.
- Backend production dependency audit: 0 vulnerabilities after a scoped ExcelJS UUID override; the container image was rebuilt with the generated backend lockfile.
- Root workspace lockfile resolves UUID to 11.1.1 via a root override. Updated frontend Vite to 6.4.3 (locked to 6.4.4); full workspace and frontend production audits report 0 vulnerabilities.
- Rebuilt and restarted the local Compose frontend with the patched Vite dependency; frontend and backend health checks return HTTP 200.
- Pushed locally validated backend and frontend images to ECR as `20261020-localvalidated`; both image tags are active.
- Created the production Secrets Manager secret and registered backend task definition revision 6 with scoped secret injection; ECS execution role has `GetSecretValue` permission scoped to that secret only.
- Verified the secret's DATABASE_URL host/database without revealing values. A one-off private ECS task successfully authenticated to the replacement PostgreSQL 18.3 database.
- Started backend ECS task definition revision 6 and frontend revision 3, one task each. Both ALB targets are healthy; frontend and proxied backend health endpoints return HTTP 200.
- Backend startup installed pgvector 0.8.1 and created the new additive application schema. The encrypted pre-import snapshot was taken before data migration.
- Imported 541,909 UCI retail rows to AWS, including 9,288 cancellation invoices and 135,080 rows with missing customer IDs. Verification confirmed the legacy tables were preserved (4 customers, 4 products, 5 sales).
- Indexed the AWS RAG corpus: 5 documents and 6 chunks. Production `/api/rag/search` returned 5 documents; `/api/ask` returned analytics rows, retrieved context, and citations.
- Created encrypted post-migration manual snapshot `agentic-bi-db-secure-post-migration-20261021`; it was verified available.
- Verified frontend HTTP 200 and backend `/api/health` HTTP 200 with the database connected.
- Smoke-tested `/api/rag/search` (5 attributed documents returned) and `/api/ask` (SQL results, retrieved context, and citations returned). External LLM requests now time out and fall back rather than leaving requests hanging.
- Fixed Python command detection to reject Windows app aliases that exit unsuccessfully; backend syntax check passed after the fix.
- Added MCP and database-pool cleanup to the integration test suite so the Node test process exits cleanly.
- Backend integration suite: 25 passed, 0 failed against the isolated local `agentic_bi_test` database. Tests used an invalid temporary Gemini key to avoid paid API calls; development retail data remained unchanged.
- Handwritten sample transaction rows are now in `backend/test/fixtures/retail-test-data.sql` only; integration tests require an explicit local `TEST_DATABASE_URL` ending in `_test` and reject RDS hosts.
- Backend JavaScript syntax checks and VS Code diagnostics passed for the modified server, RAG, MCP, importer, and frontend files.

### Remaining work and operational considerations
- The integration suite was run with a deliberately invalid Gemini key to avoid API charges. Real Gemini text generation in `/api/ask` was not validated in the suite; the deterministic fallback works, and live Gemini indexing/search were separately exercised.
- The local `agentic_bi` collation mismatch was resolved by reindexing the database and refreshing its version to 2.36. The separate administrative `postgres` database still prints a collation warning.
- Automated RDS backup retention is 0 because the AWS account's Free Tier restriction rejected the requested retention. Encrypted manual snapshots are available; consider resolving the account restriction and enabling automated backups.
- Both internet-facing ALBs and the running ECS services can incur AWS charges; monitor service health and spend.
- ECS tasks currently receive public IPs in the existing public subnets. Review moving them to private subnets as a separate deployment-hardening task.
- Provider key material was exposed in an earlier local `.env` tool output. Do not copy credentials into this document; revoke and replace the affected keys before production use. Rotation has not been performed.

## Historical AWS deployment progress (2026-10-11)
- AWS CLI successfully authenticated with the deployer IAM user in the `ap-southeast-2` region.
- Created ECR repositories for the backend and frontend images.
- Logged Docker into Amazon ECR successfully.
- Built and pushed both production container images to ECR.
- Current state: application images are ready in AWS to be used by ECS or another container runtime.
- Next step: provision the database and ECS/ALB infrastructure, then wire the environment variables and deploy the services.

## Previous application state
The following describes the state before the 2026-10-20 public-data, LangChain, and MCP upgrade and is retained as project history.

## Historical cloud deployment status (2026-10-11; superseded by current deployment)
- AWS account is authenticated and the project is using the `ap-southeast-2` region.
- RDS PostgreSQL instance is live and reachable at `agentic-bi-db.c9ysqg8o009s.ap-southeast-2.rds.amazonaws.com`.
- ECR repositories for the frontend and backend are created and images have been built and pushed successfully.
- ALB names, security groups, target groups, and listeners have been created and are active.
- The health-check target groups use the correct values: backend `/api/health` and frontend `/`.
- The final remaining issue is ECS service creation and readiness: the service definitions were created, but the live AWS service list still shows the services are missing or not yet stabilized.
- Current verification state: ALB endpoints return `HTTP 503 Service Temporarily Unavailable`, which confirms the network layer exists but no healthy ECS tasks are attached yet.
- The next deployment pass is to create the final ECS services with the correct awsvpc networking and wait for them to become `ACTIVE` and healthy before confirming the public URL.

## Latest chat session update (2026-10-11)
- Confirmed the live backend and production Docker stack are up and healthy after clearing a stale port 5001 process.
- Verified the backend health endpoint returns HTTP 200 at `/api/health` while the production compose stack is running.
- Completed the production-style deployment validation for the Dockerized frontend, backend, and PostgreSQL stack.
- Recorded the milestone as production deployment readiness rather than cloud AWS provisioning, since the real cloud rollout requires a live AWS account and registry setup.
- Continued the real cloud deployment path using AWS ECS, ALB, target groups, IAM role, and container registry setup.
- Remaining next phase is to stabilize the ECS service definitions and verify the public frontend/backend URLs are returning healthy responses instead of ALB 503s.

## Completed milestones
- Local environment restore and dependency validation
- PostgreSQL integration with Docker Compose and app configuration
- SQL-based business analytics and context retrieval
- Overview, insight, recommendation, forecast, KPI drift, region, and anomaly output generation
- Session memory, workspace, and report persistence
- JWT authentication and user-scoped storage behavior
- Dockerfiles and deployment-oriented configuration for backend/frontend
- Frontend build validation and backend regression verification
- Frontend auth experience polish
  - signed-in user state is preserved and used consistently across workspaces and reports
  - logout and demo-user mode behavior are clean and explicit
- Production deployment validation
  - local Docker Compose configuration validates successfully
  - frontend production build succeeds with Vite
- RAG/document pipeline completion
  - local document knowledge store added with search, indexing, and retrieval
  - business-document evidence is surfaced in the ask flow
- ML service and forecasting completion
  - local Python ML analysis script added for anomaly detection and forecasting
  - ML diagnostics are included in the response payload and dashboard UI
- Multi-agent orchestration improvements
  - SQL Agent, RAG Agent, signal generation, executive summary, and agent trace metadata are in place
  - fallback-safe local deterministic orchestration works without a paid model
- Product polish and enterprise features
  - role-based access control is implemented, with admin and viewer restrictions
  - workspace creation and protected actions are enforced by identity and role
  - workspace filtering and question/report search are available in the dashboard
  - report export to JSON and CSV has been added for business workflows
- Operational monitoring and observability
  - request metrics endpoint is live
  - uptime, total request count, and recent response timings are tracked
  - the UI now displays live operational metrics for visibility
- Team collaboration / enterprise polish
  - workspaces can now be marked as shared for team visibility
  - workspace search and shared-workspace visibility are supported by the dashboard and API
  - dashboard summary cards and saved-report sorting/filter controls were added to improve enterprise usability

## Next steps (2026-10-21)
1. Monitor ECS/ALB health and AWS charges; the two internet-facing ALBs and one-task backend/frontend services are active.
2. Address the AWS account restriction and enable automated RDS backups if appropriate; until then, retain and periodically verify encrypted manual snapshots.
3. Revoke and replace provider keys exposed in earlier local `.env` output before production use. No key values are stored in this document.
4. Consider moving ECS tasks from public to private subnets and review application access controls/CORS as deployment-hardening work.

## Current verification
- UCI importer dry run: 541,909 rows parsed; 9,288 cancellation invoices; 135,080 rows have no customer ID.
- Imported database counts: 541,909 retail rows, including 9,288 cancellations and 135,080 rows with no customer ID.
- RAG index: 5 documents, 6 chunks; Gemini embedding/indexing completed.
- Backend unit tests: 5 passed, 0 failed.
- Backend integration tests: 25 passed, 0 failed, using isolated `agentic_bi_test`; development dataset unchanged.
- Backend production dependency audit: 0 vulnerabilities; UUID override works in the rebuilt container.
- Root workspace dependency audit: 0 vulnerabilities after the UUID override and Vite/esbuild security updates. Frontend production Docker build succeeded using Vite 6.4.4.
- `/api/rag/search` returned 5 documents; `/api/ask` returned analytics rows, retrieved context, and citations.
- Local Compose services are running; PostgreSQL is healthy with pgvector. Frontend `http://localhost:80/` and backend `/api/health` return HTTP 200.
- Local `agentic_bi` collation version is refreshed to 2.36 after `REINDEX DATABASE`; 541,909 retail rows and 6 RAG chunks remain intact.
- AWS replacement DB is encrypted/private and available; original DB is stopped. Backend/frontend ECS services each run one task; both ALBs and the frontend-proxied backend health endpoint return HTTP 200.
- AWS database has pgvector 0.8.1 installed and the application schema created. Legacy tables retain 4 customers, 4 products, and 5 sales; AWS `retail_transactions` contains 541,909 rows.
- AWS RAG indexing completed with 5 documents and 6 chunks; production search and ask smoke tests passed.
- Encrypted post-migration manual snapshot `agentic-bi-db-secure-post-migration-20261021` was verified available.
- AWS automated DB backups remain disabled (retention 0) under the current account restriction; encrypted manual snapshots are available.
