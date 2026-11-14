# ctx = repo root
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY market/package.json market/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY market ./
# chain mode; --build-arg NEXT_PUBLIC_DEMO=1 for demo data
ARG NEXT_PUBLIC_DEMO
ARG NEXT_PUBLIC_ASSETS_ID
ARG NEXT_PUBLIC_BRAWLER_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static .next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
