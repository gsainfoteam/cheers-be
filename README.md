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
| `bun run db:seed-admin`           | 어드민 계정 등록 (아래 참고)                 |
| `bun run db:docs`                 | `docs/schema/` 생성 (아래 참고)              |
| `bun run db:docs:check`           | `docs/schema/`와 DB 비교                     |
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

## DB 스키마 문서

[`docs/schema/`](docs/schema/README.md)는 [tbls](https://github.com/k1LoW/tbls)로 생성한 테이블 문서와 ER 다이어그램입니다. 직접 고치지 마세요. 스키마를 바꾸면 다시 생성해 함께 커밋해야 하며, 어긋나면 CI `migration` job이 실패합니다.

다른 브랜치의 테이블이 섞이지 않도록 일회용 Postgres에서 생성하세요.

```bash
docker run -d --name cheers-schema-docs -e POSTGRES_USER=cheers -e POSTGRES_PASSWORD=password -e POSTGRES_DB=cheers -p 127.0.0.1:55433:5432 postgres:17
```

```bash
DATABASE_URL=postgresql://cheers:password@localhost:55433/cheers bun run db:migrate
```

```bash
DATABASE_URL=postgresql://cheers:password@localhost:55433/cheers bun run db:docs
```

```bash
docker rm -f cheers-schema-docs
```

- 테이블 · 컬럼 설명과 서비스 로직 규칙은 `.tbls.yml`에 있습니다. drizzle 스키마의 주석과 함께 고치세요.
- tbls는 `scripts/tbls.sh`가 고정된 버전을 받아 `node_modules/.cache/`에 둡니다. 따로 설치하지 않아도 됩니다.

## 어드민

`admin/`(Vite + React)을 빌드하면 백엔드가 `/admin` 아래에 서빙합니다. 로그인은 Infoteam IdP로 하고, `admin_account`에 있는 이메일만 들어올 수 있습니다.

첫 superadmin은 화면에서 만들 수 없어 환경마다 한 번 스크립트로 등록합니다. 배포 환경에서는 pod 안에서 실행합니다. role을 생략하면 superadmin이고, 이미 있는 이메일은 바꾸지 않습니다. 이후 계정은 어드민 화면에서 관리합니다.

```bash
bun run db:seed-admin -- <email>@gm.gist.ac.kr [admin|superadmin]
```

로컬에서 화면을 띄울 때는 백엔드를 켠 뒤 아래처럼 실행합니다. `http://localhost:5174/admin/callback`이 IdP 클라이언트에 등록되어 있어야 로그인할 수 있습니다.

```bash
cp admin/.env.example admin/.env
bun install --cwd admin
bun run --cwd admin dev
```

## 구조

- `drizzle/schema/` — 테이블 정의 (pgTable)
- `drizzle/` — 생성된 마이그레이션 SQL, `migrate.ts`
- `src/database/` — `DatabaseService` 및 이후 `entity/`, `repository/`
- `docs/schema/` — DB 스키마 문서와 ER 다이어그램 (tbls로 생성)
- `docs/sequence/` — API 시퀀스 다이어그램 (PlantUML, [작성 가이드](docs/sequence/README.md))
- `src/global/` — 로거, 필터, 인터셉터, 공통 DTO/타입
- `src/manager/` — 어드민 인증, 매니저 가드, 어드민 계정 API
- `admin/` — 어드민 화면 (Vite + React)

## 배포

`dev-v*` / `prod-v*` 태그를 push 하면 GitHub Actions 가 이미지를 빌드해 `ghcr.io/<repo>` 로 push 합니다.
