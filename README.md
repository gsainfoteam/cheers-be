# cheers-server

Cheers 서비스 백엔드 (NestJS 11 + Drizzle + PostgreSQL, 런타임 bun)

## 시작하기

`@gsainfoteam` 패키지를 GitHub Packages에서 받으므로 설치에 `read:packages` 권한이 있는 토큰이 필요합니다.

```bash
cp .env-template .env
export NPM_TOKEN=$(gh auth token)
bun install
docker compose up -d cheers-db
bun run start:dev
```

## 스크립트

| 명령                              | 설명                                         |
| --------------------------------- | -------------------------------------------- |
| `bun run start:dev`               | 개발 서버 (watch)                            |
| `bun run build`                   | `dist/` 로 빌드                              |
| `bun run start:prod`              | 마이그레이션 후 `dist/src/main.js` 실행      |
| `bun run lint` / `lint:check`     | oxlint                                       |
| `bun run format` / `format:check` | oxfmt                                        |
| `bun run db:generate`             | `drizzle/schema/*.ts` 기준 마이그레이션 생성 |
| `bun run db:migrate`              | 마이그레이션 적용                            |
| `bun run test`                    | 단위 테스트                                  |
| `bun run test:e2e`                | e2e 테스트 (아래 참고)                       |

## e2e 테스트

`AppModule`을 테스트 안에서 띄워 `supertest`로 호출합니다. 일회용 Postgres가 필요합니다.

```bash
docker run -d --name cheers-e2e -e POSTGRES_USER=cheers -e POSTGRES_PASSWORD=password -e POSTGRES_DB=cheers_e2e -p 127.0.0.1:55432:5432 postgres:17
```

```bash
DATABASE_URL=postgresql://cheers:password@localhost:55432/cheers_e2e bun run db:migrate
```

```bash
bun run test:e2e
```

- DB 주소는 `E2E_DATABASE_URL`만 보고(기본값은 위 컨테이너), 로컬의 `*_e2e` DB가 아니거나 쿼리 문자열이 있으면 시작하지 않습니다. 테스트마다 유저 데이터를 TRUNCATE합니다.
- `.env`는 읽지 않습니다. `test/setup-env.ts`가 `.env`가 없는 `test/`로 이동하고, 셸의 값도 쓰지 않도록 `.env-template`의 키를 모두 비운 뒤 더미 값을 넣습니다.
- Google 로그인 · 메일 · Slack · S3는 가짜로 대체해 외부로 나가지 않습니다 (`test/support/`).
- 로그는 기본으로 끕니다. 디버깅할 때 `E2E_LOG=true`를 붙이세요.

## 구조

- `drizzle/schema/` — 테이블 정의 (pgTable)
- `drizzle/` — 생성된 마이그레이션 SQL, `migrate.ts`
- `src/database/` — `DatabaseService` 및 이후 `entity/`, `repository/`
- `docs/sequence/` — API 시퀀스 다이어그램 (PlantUML, [작성 가이드](docs/sequence/README.md))
- `src/global/` — 로거, 필터, 인터셉터, 공통 DTO/타입

## 배포

`dev-v*` / `prod-v*` 태그를 push 하면 GitHub Actions 가 이미지를 빌드해 `ghcr.io/<repo>` 로 push 합니다.
