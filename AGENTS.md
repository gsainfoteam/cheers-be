# AGENTS.md

## DTO와 Swagger

Swagger 문서는 `nest-cli.json`의 `@nestjs/swagger` 플러그인이 DTO 필드 타입을 읽어 만듭니다.

### 상속한 DTO에서 부모 필드의 타입을 다시 선언하지 않기

- 자식 DTO에서 부모와 같은 이름의 필드를 다시 선언하지 않습니다. `declare`, `override`, 타입만 바꾼 재선언 모두 해당합니다.
- 이유: 부모 DTO가 문서에 먼저 올라오면 Swagger가 부모의 필드 메타데이터를 자식에게도 있는 것으로 보고 자식의 타입을 버립니다. 목록 API(`SentRequestDto`)가 상세 API보다 먼저 등록되어 있어서, 상세 DTO가 `declare graduated: RequestGraduatedDetailDto`로 타입을 바꿔도 문서에는 부모의 `RequestGraduatedDto`가 나왔습니다 (CRB-105). 문서가 읽히는 순서에 따라 결과가 달라져, DTO 하나만 따로 띄워 보면 재현되지 않습니다.
- 대신 공통 필드만 담은 베이스 클래스를 만들고, 타입이 다른 필드는 각 클래스가 자기 것으로 선언합니다.

```ts
// 나쁜 예
export class SentRequestDto {
  graduated: RequestGraduatedDto;
}
export class SentRequestDetailDto extends SentRequestDto {
  declare graduated: RequestGraduatedDetailDto;
}

// 좋은 예: graduated를 베이스에 두지 않음
export class SentRequestBaseDto {
  id: string;
}
export class SentRequestDto extends SentRequestBaseDto {
  graduated: RequestGraduatedDto;
}
export class SentRequestDetailDto extends SentRequestBaseDto {
  graduated: RequestGraduatedDetailDto;
}
```

- 필드를 추가만 하는 상속(`CoffeeChatRequestDetailDto extends CoffeeChatRequestDto` 등)과 `PickType` · `OmitType`은 괜찮습니다.
- `src/global/swagger/swagger.config.spec.ts`의 `DTO inheritance` 테스트가 모든 `*.dto.ts`에서 부모와 같은 이름의 필드를 선언한 자식을 찾아 실패시킵니다.
- 상세 응답에 새 DTO를 쓰게 되면, 같은 스펙 파일에서 문서에 그 타입이 실제로 나오는지도 확인합니다.

관련 흐름: [docs/sequence/flow/swagger-dto-inheritance.puml](docs/sequence/flow/swagger-dto-inheritance.puml)
