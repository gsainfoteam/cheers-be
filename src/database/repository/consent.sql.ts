import { SQL, sql } from "drizzle-orm";

// 약관 쿼리 공용 조각. 모두 consent 테이블의 별칭이 c 라고 가정
// 가입 단계 가드의 next_step = consent 와 내 정보의 consent_required 가 같은 답을 내도록 한 곳에서 관리

// 최신 버전: type별 (created_at, version)이 가장 큰 행.
// created_at이 같으면 version을 문자열로 비교하므로 "10.0" < "9.0".
// 운영 규칙: 한 트랜잭션(같은 NOW())에 같은 type의 버전을 여러 개 넣지 말 것. 꼭 넣어야 하면 created_at을 명시
export const isLatestConsent: SQL = sql`
  NOT EXISTS (
    SELECT 1 FROM consent newer
    WHERE newer.type = c.type
      AND (newer.created_at, newer.version) > (c.created_at, c.version)
  )`;

// 이 약관 버전에 유효한(revoked_at IS NULL) 동의가 있음
export const hasValidAgreement = (userPk: string): SQL => sql`
  EXISTS (
    SELECT 1 FROM user_consent uc
    WHERE uc.user_pk = ${userPk}
      AND uc.consent_type = c.type
      AND uc.consent_version = c.version
      AND uc.revoked_at IS NULL
  )`;

// 필수 약관의 최신 버전 중 유효한 동의가 없는 것이 있음
export const hasMissingRequiredConsent = (userPk: string): SQL => sql`
  EXISTS (
    SELECT 1 FROM consent c
    WHERE c.is_required
      AND ${isLatestConsent}
      AND NOT ${hasValidAgreement(userPk)}
  )`;
