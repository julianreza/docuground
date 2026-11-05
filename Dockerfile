FROM oven/bun:1.4.4 AS bun
FROM node:24.11.1-bookworm-slim AS app
WORKDIR /app
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]
