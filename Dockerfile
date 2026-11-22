# Build context is the monorepo root (see wrangler.toml -> containers.images.base).
# Debian (not Alpine) is used so Playwright's Chromium can run inside the image.
FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

# Manifests first so dependency installation is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/scanner/package.json packages/scanner/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY fixtures/package.json fixtures/package.json
COPY tests/e2e/package.json tests/e2e/package.json

RUN pnpm install --frozen-lockfile

# Workspace packages are consumed as TypeScript sources, so copy them verbatim.
COPY apps ./apps
COPY packages ./packages

RUN pnpm --filter @offscript/web build

# Next.js and Chromium need write access to their caches at runtime.
RUN mkdir -p /ms-playwright && chown -R 10001:10001 /app /ms-playwright

ENV HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

USER 10001:10001

CMD ["pnpm", "--filter", "@offscript/web", "start"]
