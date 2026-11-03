# nest build 는 node 로 실행해야 함: bun 으로 실행하면 bun 이 tsconfig paths 를 직접 resolve 해서
# Nest CLI 가 @src/*, @drizzle/* alias 를 상대 경로로 치환하지 않고 그대로 남김
FROM node:24-slim AS builder

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

COPY package.json bun.lock .npmrc ./

# @gsainfoteam 패키지는 GitHub Packages에 있어 설치할 때 토큰이 필요함 (이미지에는 남지 않음)
RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN \
  bun install --frozen-lockfile

COPY . .

RUN bun run build

# 개발용 seed는 staging 이미지에만 넣음 (staging.yml). 인자를 빠뜨리면 빠지는 쪽이 기본값.
# production 단계는 여기서 복사해 가므로 최종 이미지의 어느 레이어에도 남지 않음
ARG INCLUDE_DEV_SEED=false
RUN if [ "$INCLUDE_DEV_SEED" != "true" ]; then \
    rm -rf drizzle/seed-dev* dist/drizzle/seed-dev*; \
  fi

# 어드민 화면. VITE_* 값은 빌드 때 번들에 들어가므로 런타임 env가 아니라 빌드 인자로 받음
ARG VITE_IDP_AUTHORIZE_URL
ARG VITE_IDP_CLIENT_ID
# 개발용 회원 완전탈퇴 메뉴. staging.yml에서만 true (API는 런타임 env DEV_USER_DELETE_ENABLED로 따로 막음)
ARG VITE_DEV_USER_DELETE_ENABLED=false
RUN cd admin \
  && bun install --frozen-lockfile \
  && bun run build

FROM oven/bun:1-slim AS production

RUN apt-get update \
  && apt-get install -y --no-install-recommends tzdata \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock .npmrc ./

RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN \
  bun install --production --frozen-lockfile --ignore-scripts

COPY --from=builder --chown=bun:bun /app/drizzle ./drizzle

COPY --from=builder --chown=bun:bun /app/dist ./dist

COPY --from=builder --chown=bun:bun /app/admin/dist ./admin/dist

USER bun

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "start:prod"]
