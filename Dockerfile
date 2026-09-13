FROM oven/bun:1.3-debian

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun

ENV ANVIA_MEMORY_PATH=/app/data/anvia-memory.sqlite
ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts"]
