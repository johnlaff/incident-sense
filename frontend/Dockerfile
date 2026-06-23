# syntax=docker/dockerfile:1
# Multi-stage build for the Next.js frontend, producing a small standalone server
# that runs as a non-root user.

FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:26-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined at build time; the browser reaches the API on
# the host, so this defaults to localhost. Override with a build-arg if needed.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:26-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN useradd --create-home --uid 10001 nextjs
# "standalone" output bundles a minimal server with only the needed node_modules.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER nextjs

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=20s \
    CMD ["node", "-e", "fetch('http://localhost:3000').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

LABEL org.opencontainers.image.source="https://github.com/johnlaff/incident-sense" \
      org.opencontainers.image.description="incident-sense web UI (animated incident map)" \
      org.opencontainers.image.licenses="MIT"

CMD ["node", "server.js"]
