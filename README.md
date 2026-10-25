# cheers-server

Cheers 서비스 백엔드 (NestJS 11 + Drizzle + PostgreSQL, 런타임 bun)

## 시작하기

```bash
cp .env-template .env
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

## 구조

- `drizzle/schema/` — 테이블 정의 (pgTable)
- `drizzle/` — 생성된 마이그레이션 SQL, `migrate.ts`
- `src/database/` — `DatabaseService` 및 이후 `entity/`, `repository/`
- `docs/sequence/` — API 시퀀스 다이어그램 (PlantUML, [작성 가이드](docs/sequence/README.md))
- `src/global/` — 로거, 필터, 인터셉터, 공통 DTO/타입

## 배포

`dev-v*` / `prod-v*` 태그를 push 하면 GitHub Actions 가 이미지를 빌드해 `ghcr.io/<repo>` 로 push 합니다.
