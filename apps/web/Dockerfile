FROM node:22-alpine

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MAP_STYLE_URL
ARG NEXT_PUBLIC_GEOCODE_URL
ARG NEXT_PUBLIC_ROUTE_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL
ENV NEXT_PUBLIC_GEOCODE_URL=$NEXT_PUBLIC_GEOCODE_URL
ENV NEXT_PUBLIC_ROUTE_URL=$NEXT_PUBLIC_ROUTE_URL
RUN pnpm build:packages && pnpm --filter @cropcircle/web build

EXPOSE 3000
USER node
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "--hostname", "0.0.0.0"]
