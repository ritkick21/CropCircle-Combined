# Environment variables

For development defaults and Compose port overrides, see the root and service `.env.example` files. Keep deployment secrets in the environment-specific AWS Secrets Manager entry. Rotate JWT and service secrets using coordinated ECS releases. Rotating the JWT signing secret requires users to authenticate again.

| Scope | Keys | Value |
| --- | --- | --- |
| GitHub environment | `AWS_REGION`, `AWS_STACK_NAME`, `AWS_DEPLOY_ROLE_ARN` | Region, foundation stack name and GitHub OIDC role. |
| GitHub environment | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | TLS-capable mail relay and verified sender. Use 465 for implicit TLS or a STARTTLS port. |
| GitHub environment | `MAP_STYLE_URL`, `GEOCODE_URL`, `ROUTE_URL` | Optional overrides for browser map services. |
| Secrets Manager | `api_database_url`, `migration_database_url` | URL-encoded PostgreSQL connection strings with `sslmode=require&sslaccept=strict&sslrootcert=/etc/ssl/certs/rds-global-bundle.pem`. Start with `connection_limit=5` per API task and size the pool against the RDS connection budget. Use dedicated login roles, with schema privileges reserved for migration. |
| Secrets Manager | `ml_database_url` | PostgreSQL connection string with `sslmode=verify-full`. The task sets `PGSSLROOTCERT` to the RDS CA bundle in the image. |
| Secrets Manager | `redis_token`, `redis_url` | Redis token and matching `rediss://:TOKEN@CACHE_HOST:6379/0` URL. |
| Secrets Manager | `jwt_secret`, `ml_service_key` | Two independent random secrets. Generate each using `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` in a secure session. |
| Secrets Manager | `smtp_user`, `smtp_password` | Mail relay credentials. |
| API runtime | `NODE_ENV`, `PORT`, `WEB_ORIGIN`, `TRUST_PROXY` | AWS uses production, port 3001, the exact HTTPS browser origin and one trusted ALB hop. Leave `TRUST_PROXY` unset for a directly exposed local process. |
| Backend runtime | `DATABASE_URL`, `REDIS_URL`, `ML_SERVICE_KEY` | Injected from the appropriate secret fields. |
| API runtime | `ML_SERVICE_URL`, `REALTIME_PREFIX` | Task-local FastAPI URL and environment-specific Redis key prefix. |
| API runtime | `AUTH_JWT_SECRET`, `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT`, `AUTH_SMTP_USER`, `AUTH_SMTP_PASSWORD`, `AUTH_MAIL_FROM` | Session secret and email configuration. |
| API runtime | `S3_BUCKET`, `S3_REGION` | Foundation outputs and AWS Region. The AWS task uses IAM role credentials. Endpoint, static credentials and auto-create settings are for the local S3 emulator. |
| ML runtime | `ML_SERVICE_HOST`, `ML_SERVICE_PORT`, `ML_MODEL_DIR`, `ML_WORKER_ENABLED` | AWS uses loopback port 8000, bundled models and an enabled worker. |
| Web runtime | `API_INTERNAL_URL`, `HOSTNAME`, `PORT` | Task-local API base URL, HTTP bind address and listener port. |
| Web build | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MAP_STYLE_URL`, `NEXT_PUBLIC_GEOCODE_URL`, `NEXT_PUBLIC_ROUTE_URL` | Public client routing. AWS uses the relative `/api/v1` base. Rebuild the web image to change browser configuration. |

[Prisma 6 PostgreSQL TLS options](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql)
