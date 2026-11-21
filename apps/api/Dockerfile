FROM node:22-bookworm-slim AS builder
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cropcircle/shared-types build
RUN pnpm --filter @cropcircle/api db:generate
RUN pnpm --filter @cropcircle/api build

FROM node:22-bookworm-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY --from=builder /workspace /workspace
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
RUN chmod 0644 /etc/ssl/certs/rds-global-bundle.pem
WORKDIR /workspace/apps/api
ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
