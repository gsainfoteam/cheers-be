# nest build 는 node 로 실행해야 함: bun 으로 실행하면 bun 이 tsconfig paths 를 직접 resolve 해서
# Nest CLI 가 @src/* alias 를 상대 경로로 치환하지 않고 그대로 남김
FROM node:24-slim AS builder

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

FROM oven/bun:1-slim AS production

RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --production --frozen-lockfile --ignore-scripts

COPY --from=builder --chown=bun:bun /app/drizzle ./drizzle

COPY --from=builder --chown=bun:bun /app/dist ./dist

USER bun

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "start:prod"]
