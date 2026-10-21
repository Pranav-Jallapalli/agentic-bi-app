# Production deployment plan

This project is now prepared for a production-style deployment pattern using Dockerized services and an AWS-hosted architecture.

## 1. Production architecture

Recommended production layout:

- Frontend: React app served from a static host or Nginx container, then fronted by CloudFront
- Backend: Node.js Express API running in ECS Fargate or a containerized service
- Database: PostgreSQL in Amazon RDS
- Secrets: AWS Secrets Manager for `JWT_SECRET`, `GEMINI_API_KEY`, and database credentials
- Networking: Application Load Balancer + Route 53 + ACM certificate
- Observability: CloudWatch + application logs + uptime alarms
- Storage: S3 for static assets, backups, and document uploads

## 2. Production deployment topology

### Recommended AWS stack

- VPC with public and private subnets
- ALB in public subnet to expose the API and frontend
- ECS Fargate services for backend and optional admin workers
- RDS PostgreSQL multi-AZ instance for data persistence
- S3 + CloudFront for frontend hosting
- Secrets Manager for app secrets
- CloudWatch for logs, metrics, alarms, and dashboards
- Route 53 + ACM for DNS and TLS termination

### Flow

1. The frontend is served from S3/CloudFront or from a production Nginx container.
2. API requests go to the ALB and then to the backend service.
3. The backend connects to RDS PostgreSQL.
4. LLM credentials and environment secrets are loaded from AWS Secrets Manager.
5. CloudWatch captures logs, latency, and health checks for alerting.

## 3. Containerization status

The repository now includes production-oriented container assets for the app:

- `backend/Dockerfile`
- `frontend/Dockerfile`
- `frontend/nginx.conf`
- `docker-compose.production.yml`

These are meant to support a production deployment path, while preserving the existing local development setup in `docker-compose.yml`.

## 4. Required environment variables

Set these in production:

- `PORT=5001`
- `DATABASE_URL=<rds-postgres-url>`
- `JWT_SECRET=<strong-random-secret>`
- `FRONTEND_URL=https://<your-domain>`
- `LLM_PROVIDER=gemini`
- `GEMINI_API_KEY=<gemini-key>`
- `GEMINI_MODEL=gemini-3.8-flash`
- `GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta`
- `OPENAI_API_KEY=<optional>`
- `OPENAI_MODEL=gpt-4o-mini`

## 5. Deployment steps

### Option A: Docker Compose production stack

```bash
docker compose -f docker-compose.production.yml up --build -d
```

This gives a local production-style deployment with PostgreSQL, backend, and frontend services.

### Option B: AWS deployment

1. Build backend and frontend images.
2. Push images to Amazon ECR.
3. Provision RDS PostgreSQL.
4. Store secrets in AWS Secrets Manager.
5. Create ECS task definitions and services.
6. Set up ALB, target groups, and health checks.
7. Front the frontend with CloudFront and S3 or Nginx.
8. Configure Route 53 and ACM.
9. Enable CloudWatch alarms for service health and latency.

## 6. Health and release checks

Before launch, validate:

- backend `/api/health` returns 200
- metrics endpoint reports healthy service state
- database connection works from the application
- LLM provider is reachable from the production environment
- frontend loads successfully over HTTPS
- application logs are flowing to CloudWatch

## 7. Security checklist

- rotate all production secrets
- restrict database and service access with IAM and security groups
- use TLS offloading via ALB/CloudFront
- keep secrets out of source control
- run least-privilege IAM policies
- enable log retention and alerting

## 8. Final milestone status

This milestone is complete from a project-planning and deployment-readiness standpoint: the app is now containerized with a production-oriented architecture, environment contract, and AWS deployment blueprint ready for implementation.
