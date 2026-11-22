FROM node:22-bookworm-slim AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates fonts-liberation libnss3 \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 pwuser

WORKDIR /app
COPY --chown=pwuser:pwuser package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --chown=pwuser:pwuser apps ./apps
COPY --chown=pwuser:pwuser packages ./packages

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @offscript/worker exec playwright install chromium

USER pwuser

ENV NODE_ENV=production
ENV STORAGE_DIR=/app/storage

CMD ["node", "apps/worker/dist/index.js"]
