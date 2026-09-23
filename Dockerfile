FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY activity activity
RUN bun run activity:build
USER bun
CMD ["bun", "activity/server.ts"]
