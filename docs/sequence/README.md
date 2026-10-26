# API 시퀀스 다이어그램

각 API의 처리 흐름(가드, 요청 검증, 트랜잭션, 외부 호출, 비동기 알림, 에러 분기)을 PlantUML 시퀀스 다이어그램으로 남깁니다. 기준은 명세가 아니라 **실제 구현**입니다.

## 목록

| 파일                                                                                 | 내용                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| [flow/auth-guards.puml](flow/auth-guards.puml)                                       | 공통 인증 · 가입 단계 · 유형 가드                  |
| [flow/withdrawal-purge.puml](flow/withdrawal-purge.puml)                             | 스케줄러: 탈퇴 유예기간 만료 처리                  |
| [flow/file-upload.puml](flow/file-upload.puml)                                       | 파일 업로드 · 확정 · 조회 · 삭제                   |
| [user/post-oauth-login.puml](user/post-oauth-login.puml)                             | `POST /api/v1/user/oauth/login`                    |
| [user/post-refresh.puml](user/post-refresh.puml)                                     | `POST /api/v1/user/refresh`                        |
| [user/get-info.puml](user/get-info.puml)                                             | `GET /api/v1/user/info`                            |
| [user/post-logout.puml](user/post-logout.puml)                                       | `POST /api/v1/user/logout`                         |
| [user/post-withdraw.puml](user/post-withdraw.puml)                                   | `POST /api/v1/user/withdraw`                       |
| [consent/get-consent-list.puml](consent/get-consent-list.puml)                       | `GET /api/v1/user/consent/list`                    |
| [consent/post-consent.puml](consent/post-consent.puml)                               | `POST /api/v1/user/consent`                        |
| [student/post-verify-send-code.puml](student/post-verify-send-code.puml)             | `POST /api/v1/user/student/verify/send-code`       |
| [student/post-verify-code.puml](student/post-verify-code.puml)                       | `POST /api/v1/user/student/verify/code`            |
| [student/get-departments.puml](student/get-departments.puml)                         | `GET /api/v1/user/student/departments`             |
| [student/post-info.puml](student/post-info.puml)                                     | `POST /api/v1/user/student/info`                   |
| [file/post-business-card-upload-url.puml](file/post-business-card-upload-url.puml)   | `POST /api/v1/file/business-card/upload-url`       |
| [file/post-attachment-upload-url.puml](file/post-attachment-upload-url.puml)         | `POST /api/v1/file/attachment/upload-url`          |
| [graduated/post-verify-business-card.puml](graduated/post-verify-business-card.puml) | `POST /api/v1/user/graduated/verify/business-card` |
| [graduated/post-info.puml](graduated/post-info.puml)                                 | `POST /api/v1/user/graduated/info`                 |
| [cheers/get-cheers.puml](cheers/get-cheers.puml)                                     | `GET /api/v1/cheers`                               |
| [cheers/post-cheers-request.puml](cheers/post-cheers-request.puml)                   | `POST /api/v1/cheers/request`                      |
| [cheers/get-cheers-sent.puml](cheers/get-cheers-sent.puml)                           | `GET /api/v1/cheers/sent`                          |
| [cheers/get-cheers-sent-id.puml](cheers/get-cheers-sent-id.puml)                     | `GET /api/v1/cheers/sent/{id}`                     |

## 보기

GitHub은 PlantUML을 렌더링하지 않으므로 리뷰는 `.puml` 텍스트 diff로 하고, 그림은 로컬에서 확인합니다.

- IntelliJ: PlantUML Integration 플러그인 (Graphviz 필요 없음)
- Docker: `docs/sequence/out/`에 PNG 생성 (`out/`은 커밋하지 않음)

```bash
docker run --rm -v "$PWD/docs/sequence:/data" plantuml/plantuml -tpng -o /data/out "/data/**/*.puml"
```

- 이미지에 한글 폰트가 없어 한글이 네모로 나오면 폰트 파일을 마운트 (macOS는 `/System/Library/Fonts`를 Docker에 바로 공유할 수 없어 복사해서 씀)

```bash
mkdir -p /tmp/plantuml-fonts && cp /System/Library/Fonts/AppleSDGothicNeo.ttc /tmp/plantuml-fonts/
```

```bash
docker run --rm -v "$PWD/docs/sequence:/data" -v /tmp/plantuml-fonts:/usr/share/fonts/extra:ro plantuml/plantuml -tpng -o /data/out "/data/**/*.puml"
```

- 문법 검사만

```bash
docker run --rm -v "$PWD/docs/sequence:/data" plantuml/plantuml -checkonly "/data/**/*.puml"
```

## PR 규칙

- API를 추가하거나 흐름을 바꾸는 PR은 해당 `.puml`을 같이 추가 · 수정하고 위 목록에 한 줄 추가
- 올리기 전에 문법 검사 통과 확인

## 파일 위치

- API 하나당 한 파일: `<명세 섹션>/<method>-<path slug>.puml`
  - 섹션 디렉터리는 API 명세서 목차를 따름: `user`, `consent`, `student`, `graduated`, ...
  - 예: `POST /api/v1/user/consent` → `consent/post-consent.puml`, `GET /api/v1/user/info` → `user/get-info.puml`
- 여러 API에 걸친 큰 흐름은 `flow/<name>.puml`
  - 예: 회원가입(로그인 → 약관 동의 → 인증 → 추가 정보 입력)은 가입 API들이 들어올 때 `flow/signup.puml`로 추가. API 하나하나의 내부는 각 API 파일에 두고, 플로우 파일은 API 사이의 순서 · 분기(`next_step`)만 그림

## 작성 규칙

### 머리말

파일마다 아래 스타일 블록을 그대로 복사해 씁니다 (파일 하나만 열어도 렌더링되도록 `!include` 없이). 스타일을 바꿀 때는 모든 파일을 같이 바꿉니다.

```plantuml
@startuml post-consent
skinparam defaultFontName "Apple SD Gothic Neo", "Noto Sans CJK KR", sans-serif
skinparam responseMessageBelowArrow true
skinparam sequenceMessageAlign left
skinparam maxMessageSize 260
skinparam BoxPadding 8
skinparam shadowing false
autonumber
hide footbox

title POST /api/v1/user/consent
caption CRB-12 · 한 줄 설명
```

### 참여자

왼쪽에서 오른쪽으로 이 순서를 지키고, 이름은 실제 클래스명을 씁니다. 쓰지 않는 참여자는 빼도 됩니다.

| 순서 | 참여자                             | 선언                                                                  |
| ---- | ---------------------------------- | --------------------------------------------------------------------- |
| 1    | 클라이언트                         | `actor Client`                                                        |
| 2    | 가드                               | `participant "UserGuard" as Guard`                                    |
| 3    | 요청 검증 (body · query가 있을 때) | `participant "ValidationPipe" as Pipe`                                |
| 4    | 컨트롤러                           | `participant "ConsentController" as Controller`                       |
| 5    | 서비스 (여러 개면 호출 순서대로)   | `participant "ConsentService" as Service`                             |
| 6    | 리포지토리                         | `participant "ConsentRepository" as ConsentRepository`                |
| 7    | DB                                 | `database PostgreSQL`                                                 |
| 8    | 외부 시스템                        | `participant "S3"`, `"Infoteam IdP"`, `"Solapi"`, `"SMTP"`, `"Slack"` |

### 가드

- API 파일에서는 가드를 한 단계로 줄이고 `ref over`로 [flow/auth-guards.puml](flow/auth-guards.puml)을 가리킴. 이 API에서 나올 수 있는 401 · 403과 가드 옵션(`@SignupStep`, `@UserTypes`)만 적음

```plantuml
Client -> Guard: GET /api/v1/...\nAuthorization: Bearer <access token>
ref over Client, Guard: UserGuard — flow/auth-guards.puml\n401 ... / 403 Signup is not completed
Guard -> Controller: ...
```

- 가드 동작 자체가 바뀌면 `flow/auth-guards.puml`을 수정

### 요청 검증

Nest 실행 순서상 가드 다음, 컨트롤러 앞입니다.

```plantuml
Guard -> Pipe: 통과
alt body 검증 실패 (조건 요약)
  Pipe -[#red]-> Client: 400 (class-validator 메시지)
end
Pipe -> Controller: ...
```

### 에러 분기

- `alt <조건>` ... `else` ... `end`, 에러 응답은 빨간 점선 `-[#red]->`로 예외를 던진 참여자에서 `Client`에게
- 메시지는 코드의 예외 메시지 그대로: `400 Duplicate consent type`. 값이 들어가는 부분은 `<type>`처럼 표기
- 응답 형식은 `AllExceptionsFilter`가 정함: `HttpException`이면 `{ statusCode, message }`, 그 외 예외는 500 `An unexpected error occurred.` + Slack 알림. 다이어그램에는 상태 코드와 메시지만 적음
- 설정 오류처럼 요청으로는 일어나지 않는 500은 note로만

### 트랜잭션

`DatabaseService.db.transaction` 범위를 `group`으로 감싸고, `tx`를 받는 호출은 모두 그 안에 둡니다.

```plantuml
group transaction (DatabaseService.db.transaction)
  Service -> UserRepository: ...(tx)
end
note over Service, PostgreSQL: 트랜잭션 안의 예외는 전부 rollback 후 응답
```

### 선택 · 반복

- 조건에 따라 일어나는 단계: `opt <조건>` ... `end`
- 반복: `loop <대상>` ... `end`

### 비동기 (fire-and-forget)

알림톡 · 메일처럼 응답을 기다리지 않는 호출은 비동기 화살표 `->>`와 note로 표시하고, 트랜잭션 커밋 뒤에 일어나는지 분명히 둡니다.

```plantuml
Service ->> NotificationService: notifyAsync(...)
note right: 응답을 기다리지 않음. 실패는 서비스 안에서 로그로 처리
```

### DB · 외부 호출

- SQL 전문 대신 요지만: `SELECT consent (type별 최신 버전) + 내 유효한 동의 여부`
- 판단에 중요한 조건(`ON CONFLICT DO NOTHING`, `revoked_at IS NULL` 등)과 그 이유는 note로
- 외부 호출은 실패했을 때의 처리(에러 응답 / 무시 / 재시도)를 `alt`로 같이 그림
