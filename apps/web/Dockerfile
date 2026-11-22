# Self-hosted web image. Cloudflare Workers deployment uses OpenNext instead.
# No secrets are baked into this image: DATABASE_URL and provider keys are
# supplied by the container environment at runtime (see deploy/docker-compose.yml).
FROM node:22-bookworm-slim AS base

RUN corepack enable \
 && useradd --create-home --uid 10001 nextjs

WORKDIR /app

# Manifests first so dependency installation stays cacheable.
COPY --chown=nextjs:nextjs package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY --chown=nextjs:nextjs apps ./apps
COPY --chown=nextjs:nextjs packages ./packages
COPY --chown=nextjs:nextjs tests ./tests
COPY --chown=nextjs:nextjs fixtures ./fixtures

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @offscript/web build

RUN chown -R nextjs:nextjs /app

# Never run as root, and never disable the Chromium sandbox in Docker.
USER nextjs

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "--filter", "@offscript/web", "start"]
