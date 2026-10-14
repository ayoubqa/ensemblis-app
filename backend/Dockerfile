# One image for both processes:
#   API:    docker run … ensemblis-backend            (migrates, then serves)
#   Worker: docker run … ensemblis-backend node dist/worker.js
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 4000
# No image-level HEALTHCHECK: the same image runs the worker, which has no HTTP server.
# Probe the API container at GET /health (readiness, checks the database) or /health/live.
# Apply pending migrations (prisma migrate deploy, never db push), then serve.
CMD ["sh", "-c", "node dist/ops/migrate.js && node dist/index.js"]
