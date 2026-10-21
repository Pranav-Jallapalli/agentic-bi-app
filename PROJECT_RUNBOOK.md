# Agentic BI Platform — Project Runbook and Interview Guide

## Current implementation (2026-10-20)

The active development path uses the UCI Online Retail dataset as the primary SQL analytics source. The archive is 22.6 MB with 541,909 invoice-line records and is licensed CC BY 4.0; source and attribution details are in `database/data/README.md`. The old customer/product/sales demo rows are no longer inserted by the production schema. Test fixtures may remain synthetic.

The SQL schema is `retail_transactions`. It preserves cancellation invoices and rows with missing customer IDs. Revenue is calculated in GBP as quantity multiplied by unit price. Questions mentioning the latest/last month are interpreted against the latest month present in this historical dataset, not the current calendar month.

RAG uses LangChain.js `RecursiveCharacterTextSplitter`, Gemini embeddings, and LangChain `PGVectorStore` backed by PostgreSQL pgvector. Public UCI and ONS context includes source, publication date, license, and attribution metadata. Existing `backend/data/documents.json` documents are preserved as user-provided content and are included in indexing; their reuse license is unspecified.

The Express backend is the MCP host. It launches two stdio MCP servers and maintains one client for each:

- SQL server: fixed read-only tools for product, country, customer, and monthly revenue analytics.
- Vector server: semantic retrieval with LangChain pgvector, returning document provenance for citations.

AWS services remain paused. The steps below operate locally only.

### Local startup and data setup

1. Ensure Docker Desktop is running, then start PostgreSQL with pgvector:

  ```sh
  docker compose up -d postgres
  ```

2. Configure `backend/.env` from `backend/.env.example`. Set a Gemini key for embeddings and semantic search. Never commit the populated `.env` file.

3. Preview and import the dataset:

  ```sh
  npm --prefix backend run data:import -- --dry-run
  npm --prefix backend run data:import
  ```

  The importer reads the workbook as a stream, validates its columns and rows, and records the archive checksum. Re-running it with the same archive does not duplicate rows.

4. Index the public and preserved user documents:

  ```sh
  npm --prefix backend run rag:index
  ```

5. Start the frontend and backend locally:

  ```sh
  npm run dev
  ```

If Docker is unavailable, the backend can still start and report degraded database health, but PostgreSQL-backed analytics, dataset import, and semantic retrieval require the database. If Gemini is unavailable, chunking tests can still run, but embeddings and semantic vector search require the configured key.

### Backend test commands

Run database-independent tests without Docker:

```sh
npm --prefix backend run test:unit
```

The HTTP/API integration suite uses synthetic rows only in a dedicated test database. Create `agentic_bi_test` in local PostgreSQL, then set `TEST_DATABASE_URL` to that database before running:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:55432/agentic_bi_test'
npm --prefix backend run test:integration
Remove-Item Env:TEST_DATABASE_URL
```

The integration setup truncates `retail_transactions` in the configured test database before loading `backend/test/fixtures/retail-test-data.sql`. The test runner requires a database name ending in `_test`; never point it at the normal development database, RDS, or any production environment.

## 1. What this project really is

This project is an Agentic Business Intelligence platform built as a full-stack SaaS-style dashboard for business users and analysts.

The application is designed to help users ask business questions in plain English, then generate responses that blend:

- SQL-driven analytics
- RAG/document retrieval from internal knowledge
- KPI drift analysis
- forecasting and anomaly detection
- recommendation generation
- workspace/report history and collaborative access
- operational metrics and health monitoring

In simple terms, the app acts like a business analyst assistant that can:

- read business data from a database
- understand the context behind business questions
- pull relevant documents and summaries
- generate an answer with insights and recommendations
- save reports and workspaces for repeat workflows

This is not just a dashboard. It is closer to an agentic analytics cockpit with AI-assisted reasoning layered on top of business data.

---

## 2. Project goals and business value

The product aims to help teams answer questions like:

- What were the top products by revenue last month?
- Which region had the biggest KPI drop?
- Which products are trending down this quarter?
- What should we do based on the current sales performance?
- Which customers or regions need intervention?

The platform supports roles such as:

- admin
- analyst
- viewer
- member

It also supports enterprise-style features such as:

- user auth and RBAC
- workspace management
- saved reports
- shared workspaces
- export to JSON/CSV
- operational monitoring metrics

---

## 3. Technology stack

### Frontend
- React + Vite
- JavaScript / JSX
- UI dashboard for auth, workspace, reports, metrics, results, exports

### Backend
- Node.js + Express
- REST API architecture
- PostgreSQL client integration
- JWT auth, bcrypt, CORS, morgan

### Database
- PostgreSQL
- Used for business data and app persistence

### AI / orchestration layer
- SQL agent pattern
- RAG / document retrieval pattern
- forecasting and anomaly logic
- KPI drift / region breakdown
- deterministic fallback mode when no external model is configured
- optional provider integration for Gemini/OpenAI-compatible APIs

### Infrastructure / deployment
- Docker
- Docker Compose
- AWS ECR
- AWS RDS
- AWS ECS
- AWS ALB
- IAM
- CloudWatch logging

---

## 4. Repository structure

```text
OpenProject_2026/
├── README.md
├── package.json
├── docker-compose.yml
├── PROJECT_STATUS.md
├── PROJECT_RUNBOOK.md
├── backend/
│   ├── package.json
│   ├── Dockerfile
│   ├── src/
│   │   └── server.js
│   └── .env
├── frontend/
│   ├── package.json
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
├── database/
│   └── scripts/
│       └── create_schema.sql
├── docs/
│   └── architecture.md
└── .env
```

---

## 5. How the app works

### App flow

1. A user logs in or registers.
2. The user selects a workspace or creates one.
3. The user enters a business question.
4. The backend builds a context payload using:
   - SQL analytics data
   - document memory/RAG
   - metrics and trends
   - signal generation
5. The app returns a structured answer with:
   - overview
   - insight
   - recommendation
   - forecast
   - KPI drift summary
   - regional breakdown
   - anomaly detection
6. The result can be saved and exported.

### Decision logic

The backend supports two modes:

- local deterministic fallback mode
- external model mode using Gemini/OpenAI-compatible API keys if configured

This is important because the project was designed to continue working even when a paid LLM subscription was not available.

---

## 6. Core application features

### Authentication and access
- register/login endpoints
- JWT-based session auth
- role-based access control
- protected actions based on current user identity

### Workspaces and reports
- create workspaces
- filter workspaces by user
- save reports tied to workspace
- list saved reports
- export reports

### BI analysis features
- KPI calculations
- anomaly signals
- forecast output
- regional performance breakdown
- recommendation generation

### Operational monitoring
- request metrics endpoint
- health endpoint
- uptime and monitoring data
- performance and request tracking

### Enterprise polish features included
- shared workspaces
- team visibility
- dashboard summary cards
- search/filter logic for reports and workspaces
- export support for business use

---

## 7. Local development startup steps

### Prerequisites

Install the following on your machine:

- Node.js 20+
- npm
- Docker Desktop
- PostgreSQL (optional if using Docker Compose)
- Git

### Step 1: clone the repo

```bash
git clone <your-repo-url>
cd OpenProject_2026
```

### Step 2: install dependencies

From the root directory:

```bash
npm install
```

Or install in each workspace individually:

```bash
cd backend && npm install
cd ../frontend && npm install
```

### Step 3: start the app locally

At the project root:

```bash
npm run dev
```

This runs both backend and frontend concurrently.

### Direct backend start

```bash
cd backend
npm run dev
```

### Direct frontend start

```bash
cd frontend
npm run dev
```

### Local access URLs

- Frontend: http://localhost:5173
- Backend: http://localhost:5001
- Health endpoint: http://localhost:5001/api/health

---

## 8. Environment variables

### Backend .env example

Typical backend settings include:

```env
PORT=5001
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/agentic_bi
JWT_SECRET=agentic-bi-local-dev-secret

# optional model provider values
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
GEMINI_API_KEY=your_gemini_key_here
```

Important notes:
- If no model API key is configured, the system falls back to deterministic execution.
- This is intentional and allows the project to keep working without a paid subscription.
- Do not commit real secrets to version control.

---

## 9. Docker and Docker Compose steps

### Start local stack

From the project root:

```bash
docker compose up --build -d
```

### Check running containers

```bash
docker ps
```

Or:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

### Stop the stack

```bash
docker compose down
```

### Stop and remove volumes

```bash
docker compose down -v
```

### Check logs

```bash
docker logs agentic-bi-backend
```

```bash
docker logs agentic-bi-frontend
```

### Local Docker stack summary

The Compose file contains:
- Postgres service on port 55432
- backend on port 5001
- frontend on port 5173

This local Docker setup was used for validation before the production AWS deployment pass.

---

## 10. Build and validation commands

### Frontend build

```bash
cd OpenProject_2026
npm run build
```

### Backend tests

```bash
cd OpenProject_2026/backend
npm test
```

### Production Docker build for backend

```bash
cd OpenProject_2026/backend
docker build -t agentic-bi-backend:latest .
```

### Production Docker build for frontend

```bash
cd OpenProject_2026/frontend
docker build -t agentic-bi-frontend:latest .
```

### Local health check

```bash
curl http://localhost:5001/api/health
```

### Local frontend smoke check

```bash
curl http://localhost:5173
```

---

## 11. AWS / deployment approach used in this project

This project was later moved into a real cloud deployment pathway using AWS.

### Deployment objectives
- push Docker images to ECR
- create PostgreSQL database via RDS
- create ECS cluster and task definitions
- create ALB and target groups
- expose frontend and backend publicly
- add security groups and networking
- connect app services to the database

### AWS services used
- IAM
- ECR
- RDS
- EC2
- VPC
- Security Groups
- ALB
- ECS
- CloudWatch Logs

### Key AWS commands used

#### Authenticate

```bash
aws configure
aws sts get-caller-identity
```

#### ECR login

```bash
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com
```

#### Create repositories

```bash
aws ecr create-repository --repository-name agentic-bi-backend --region ap-southeast-2
aws ecr create-repository --repository-name agentic-bi-frontend --region ap-southeast-2
```

#### Docker push to ECR

```bash
docker tag agentic-bi-backend:latest <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/agentic-bi-backend:latest
docker push <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/agentic-bi-backend:latest

docker tag agentic-bi-frontend:latest <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/agentic-bi-frontend:latest
docker push <account-id>.dkr.ecr.ap-southeast-2.amazonaws.com/agentic-bi-frontend:latest
```

#### RDS database creation

```bash
aws rds create-db-instance \
  --db-instance-identifier agentic-bi-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --allocated-storage 20 \
  --db-name agentic_bi \
  --master-username postgres \
  --master-user-password <your-password> \
  --region ap-southeast-2
```

#### ECS cluster

```bash
aws ecs create-cluster --cluster-name agentic-bi-cluster --region ap-southeast-2
```

#### Security groups and ALB health check path issue

The major issue discovered was in a Git Bash / MSYS environment. The value for the ALB health check path was being converted incorrectly into something like:

```text
C:/Program Files/Git/api/health
```

This is invalid for AWS ALB because the path must be a literal URL path beginning with `/`.

Correct command pattern:

```bash
aws elbv2 create-target-group \
  --name agentic-bi-backend-tg \
  --protocol HTTP \
  --port 5001 \
  --vpc-id <vpc-id> \
  --target-type ip \
  --health-check-path /api/health \
  --region ap-southeast-2
```

The fix used in practice was to disable MSYS path conversion:

```bash
MSYS2_ARG_CONV_EXCL='*' aws elbv2 create-target-group ...
```

This is important because Git Bash on Windows can rewrite a valid `/api/health` into a bad Windows-style path.

---

## 12. Deployment status: what is completed and what is pending

### Completed milestones

- project idea and architecture clarified
- backend, frontend, and database stack built
- PostgreSQL integration completed
- BI analytics logic implemented
- auth and user management implemented
- report saving and workspace management completed
- Dockerfiles built and configured
- frontend production build passed
- backend tests passed
- Docker Compose validation passed locally
- AWS IAM auth configured
- ECR repositories created and Docker images pushed
- RDS instance created and reachable
- security groups created
- ALB and target groups created
- listeners configured

### Current blocker / incomplete phase

The remaining issue is not basic architecture; it is the final ECS service lifecycle and health verification.

Current evidence:

- ALB endpoints are active
- ALB listeners exist
- target groups exist
- ECS services are still not in a healthy active state
- public ALB URL returns `HTTP 503 Service Temporarily Unavailable`

This means the app is still waiting for the actual ECS tasks to become healthy and attached to the target groups.

---

## 13. Deployment error being faced

### Error summary

The main AWS deployment error that blocked the final setup was:

```text
aws: [ERROR]: An error occurred (ValidationError) when calling the CreateTargetGroup operation: Health check path 'C:/Program Files/Git/api/health' must begin with a '/' character and can only contain printable ASCII characters, without spaces
```

### Root cause

This happened because Git Bash / MSYS was converting the `--health-check-path /api/health` argument into a Windows path-like string before it reached AWS CLI.

### Why this mattered

ALB health-check paths must be literal HTTP paths starting with `/`. A Windows path like `C:/Program Files/Git/...` is invalid, so the target group creation failed.

### Fix used

```bash
MSYS2_ARG_CONV_EXCL='*' aws elbv2 create-target-group ... --health-check-path /api/health
```

This is the key lesson from the deployment: Windows Git Bash path rewriting can break AWS CLI commands even when the command looks correct.

---

## 14. Manual commands you can try to finish deployment

These are the practical commands to try next in a clean shell environment, preferably either:

- PowerShell
- normal bash shell without MSYS conversion
- WSL2

### A. Check AWS login and environment

```bash
aws sts get-caller-identity
aws ecs list-clusters --region ap-southeast-2 --output table
aws rds describe-db-instances --region ap-southeast-2 --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus,Endpoint.Address,DBName]' --output table
```

### B. Check VPC and subnets

```bash
aws ec2 describe-vpcs --filters Name=is-default,Values=true --region ap-southeast-2 --query 'Vpcs[0].VpcId' --output text
aws ec2 describe-subnets --filters Name=vpc-id,Values=<vpc-id> --region ap-southeast-2 --query 'Subnets[*].[SubnetId,AvailabilityZone]' --output table
```

### C. Check target groups and ALBs

```bash
aws elbv2 describe-target-groups --region ap-southeast-2 --query 'TargetGroups[*].[TargetGroupName,TargetGroupArn,Protocol,Port,HealthCheckPath]' --output table
aws elbv2 describe-load-balancers --region ap-southeast-2 --query 'LoadBalancers[*].[LoadBalancerName,State.Code,DNSName]' --output table
aws elbv2 describe-listeners --load-balancer-arn <backend-alb-arn> --region ap-southeast-2 --query 'Listeners[*].[Port,Protocol,DefaultActions[0].TargetGroupArn]' --output table
```

### D. Check ECS cluster and services

```bash
aws ecs describe-clusters --clusters agentic-bi-cluster --region ap-southeast-2 --query 'clusters[*].[clusterName,status,activeServicesCount,runningTasksCount]' --output table
aws ecs list-services --cluster agentic-bi-cluster --region ap-southeast-2 --output table
```

### E. Create ECS services manually (clean shell recommended)

```bash
aws ecs create-service \
  --cluster agentic-bi-cluster \
  --service-name agentic-bi-backend \
  --task-definition agentic-bi-backend \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<subnet-1>,<subnet-2>],securityGroups=[<backend-task-sg>],assignPublicIp=ENABLED}" \
  --health-check-grace-period 120 \
  --load-balancers "targetGroupArn=<backend-target-group-arn>,containerName=agentic-bi-backend,containerPort=5001" \
  --region ap-southeast-2
```

```bash
aws ecs create-service \
  --cluster agentic-bi-cluster \
  --service-name agentic-bi-frontend \
  --task-definition agentic-bi-frontend \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<subnet-1>,<subnet-2>],securityGroups=[<frontend-task-sg>],assignPublicIp=ENABLED}" \
  --health-check-grace-period 120 \
  --load-balancers "targetGroupArn=<frontend-target-group-arn>,containerName=agentic-bi-frontend,containerPort=80" \
  --region ap-southeast-2
```

### F. Check if tasks are running

```bash
aws ecs list-task-definitions --region ap-southeast-2 --output table
aws ecs list-tasks --cluster agentic-bi-cluster --region ap-southeast-2 --output table
aws ecs describe-tasks --cluster agentic-bi-cluster --tasks <task-arn> --region ap-southeast-2 --output table
```

### G. Check logs if task fails

```bash
aws logs tail /ecs/agentic-bi-backend --follow --region ap-southeast-2
aws logs tail /ecs/agentic-bi-frontend --follow --region ap-southeast-2
```

### H. Confirm the app is live

```bash
curl -I http://<frontend-alb-dns-name>
curl -I http://<backend-alb-dns-name>/api/health
```

---

## 15. Current milestone summary

### Completed to date

- MVP built and validated locally
- Docker workflow tested
- AI fallback orchestration implemented
- Dashboard UI built and tested
- Database and app integration complete
- AWS infra partly setup and registered
- ECR login and push complete
- RDS and ALB/network layer created

### Incomplete final milestone

- final ECS service deployment and public health check
- full deployment smoke test
- final public URL validation

---

## 16. Interview-ready summary

This project demonstrates a full-stack AI product-building workflow from end to end:

- end-user product idea
- backend and frontend development
- database modeling and analytics
- AI orchestration patterns
- document retrieval and business intelligence logic
- containerization and deployment readiness
- cloud deployment using AWS services

It showcases both product thinking and operational engineering, which is very valuable for interviews because it combines:

- software engineering
- backend API design
- frontend UX
- database/data handling
- AI integration patterns
- cloud deployment and infra knowledge
- debugging and problem solving

This is a strong portfolio project because it is not only a frontend demo; it is a practical business product built to work like a real AI analytics SaaS platform.

---

## 17. Final note

The project is highly functional locally and most of the AWS infrastructure is in place, but the final deployment still needs the ECS services to become healthy and the public ALB checks to pass.

The key lesson from this deployment path is that infrastructure is easy to set up incorrectly if shell quoting or Windows path conversion is not handled carefully. The issue was not the app itself — it was the quoting and path conversion bug in the AWS CLI environment.
