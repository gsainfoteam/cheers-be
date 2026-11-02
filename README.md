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
| `bun run db:seed:dev`             | 개발용 가짜 데이터 넣기 (아래 참고)          |
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

## 개발용 데이터

어드민 화면에서 목록 · 필터 · 상세를 확인할 가짜 데이터입니다. 마이그레이션과 별개이고, 다시 실행하면 개발용 데이터만 지우고 새로 넣습니다.

로컬에서는 아래 순서로 실행합니다.

```bash
docker compose up -d cheers-db
```

```bash
bun run db:migrate
```

```bash
bun run db:seed:dev
```

```bash
bun run db:seed-admin -- <email>@gm.gist.ac.kr
```

```bash
bun run start:dev
```

그다음 위 [어드민](#어드민) 절대로 화면을 띄워 로그인합니다. seed는 어드민 계정을 만들지 않습니다.

staging에서는 pod 안에서 `bun run db:seed:dev`를 실행합니다. production 이미지에는 파일이 없어 실행되지 않습니다 (`Dockerfile`의 `INCLUDE_DEV_SEED`, `staging.yml`에서만 켬).

**실행 시점 차단은 없습니다.** 시작할 때 출력되는 대상 DB를 확인하세요. 로컬에서 `DATABASE_URL`을 운영 DB로 두고 실행하면 그대로 들어가 가짜 현업자가 운영 목록에 노출됩니다.

| 대상          | 내용                                                                  |
| ------------- | --------------------------------------------------------------------- |
| 재학생 active | 25명. 학과 · 관심 분야 다양, 일부 첨부와 프로필 v2                    |
| 현업자 active | 25명 인증 완료, 3명 인증 취소. 연락수단 4종                           |
| 가입 중       | 유형별로 약관 전 · 인증 전 · 프로필 전 각 1명                         |
| 탈퇴          | 유예 중 5명(pending 1명 포함), 처리 완료 2명                          |
| 커피챗 요청   | 66건. `requested`, `viewed`, `contact_shared`, 재학생 확인, 상대 탈퇴 |
| 알림 로그     | 요청별 email · 알림톡, `sent` · `failed`                              |

- 개발용 행은 pk가 `de000000-0000-4000-8000-`로 시작합니다. 이름과 닉네임에는 `[dev]`가 붙고, 이메일은 `@dev.cheers.local`입니다. `student.email`만 학과 조회를 위해 실제 학교 도메인을 씁니다.
- 실제 유저가 개발용 현업자에게 보낸 요청은 다시 실행할 때 같이 지워집니다.
- 명함은 `drizzle/seed-dev-assets/`의 샘플 이미지를 `AWS_S3_BUCKET_NAME` 버킷의 `dev-seed/business-card/`에 올립니다(`.env-template` 기본값은 staging 버킷). 올리지 못해도 seed는 성공하고 경고만 남으며, 그 경우 명함 이미지만 404입니다. 이력서 · 포트폴리오 첨부는 더미 key라 항상 404입니다.
- 서버를 켜 두면 가입 중 유저는 24시간 뒤 정리 스케줄러가 지웁니다. 다시 실행하면 복구됩니다.
- staging에서 개발용 현업자에게 커피챗을 요청하면 서버가 실제 발송을 시도합니다. `.local` 주소와 `0100000xxxx` 번호라 전달되지 않고, 실패 기록이 `notification_log`에 남을 수 있습니다.

## 구조

- `drizzle/schema/` — 테이블 정의 (pgTable)
- `drizzle/` — 생성된 마이그레이션 SQL, `migrate.ts`
- `src/database/` — `DatabaseService` 및 이후 `entity/`, `repository/`
- `docs/schema/` — DB 스키마 문서와 ER 다이어그램 (tbls로 생성)
- `docs/sequence/` — API 시퀀스 다이어그램 (PlantUML, [작성 가이드](docs/sequence/README.md))
- `src/global/` — 로거, 필터, 인터셉터, 공통 DTO/타입
- `src/manager/` — 어드민 인증, 매니저 가드, 어드민 계정 API, 기능별 어드민 모듈 (`department/`: 학교 · 학과)
- `src/admin-repository/` — 어드민 API 전용 레포지토리. 기존 테이블을 어드민에서 조회 · 수정할 때도 `src/database/repository`를 쓰지 않고 여기에 `admin-{table}.repository.ts`를 만듦
- `admin/` — 어드민 화면 (Vite + React)

## 배포

`dev-v*` / `prod-v*` 태그를 push 하면 GitHub Actions 가 이미지를 빌드해 `ghcr.io/<repo>` 로 push 합니다.
