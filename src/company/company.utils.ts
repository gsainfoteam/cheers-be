// company_alias.pk는 integer 컬럼. 범위를 넘는 값은 DB 오류(500)가 되므로 먼저 400으로 막음
export const COMPANY_PK_MAX = 2147483647;

// 회사 검색 결과 최대 개수
export const COMPANY_SEARCH_LIMIT = 10;

/**
 * 표기만 다른 같은 회사 이름을 하나로 보기 위한 키 (company_name.normalized_name)
 * 앞뒤 공백 제거, 유니코드 표현 통일(NFC), 연속 공백을 하나로, 소문자
 * 마이그레이션 0014의 SQL backfill도 같은 규칙
 * e.g. "  Microsoft   Korea " → "microsoft korea"
 */
export function normalizeCompanyName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * escapes LIKE wildcards so user input matches literally (ESCAPE '\')
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * alias가 화면에 내보낼 이름. 원문에서 앞뒤 공백만 지우고 유니코드 표현을 통일
 */
export function toCompanyDisplayName(name: string): string {
  return name.normalize("NFC").trim();
}
