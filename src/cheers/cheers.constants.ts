// 목록 API 공통 (현업자 목록 · 보낸 요청 · 받은 요청)
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

// 커피챗 요청 질문 내용 (trim 후)
export const MESSAGE_MAX_LENGTH = 200;

// 재학생이 탈퇴했거나 탈퇴 유예기간 중일 때 받은 요청 목록에서 이름 대신 내려주는 값
export const WITHDRAWN_STUDENT_REQUEST_LABEL = "탈퇴한 학생의 신청서입니다";

// 이름이 없을 때 (active 재학생이면 사실상 없음)
export const STUDENT_FALLBACK_NAME = "재학생";

// 현업자 목록 random 정렬의 섞는 기준이 바뀌는 주기 (CHEERS_RANDOM_SEED_MINUTES 기본값)
export const DEFAULT_RANDOM_SEED_MINUTES = 60;

// 현업자가 탈퇴했거나 탈퇴 유예기간 중일 때 이름 대신 내려주는 값
export const WITHDRAWN_ACCOUNT_NAME = "탈퇴한 계정";

// 알림에 넣을 현업자 이름이 없을 때 (active 현업자면 사실상 없음)
export const GRADUATED_FALLBACK_NAME = "현업자";

export const GRADUATED_CARD_SORTS = [
  "recent_joined",
  "recent_active",
  "random",
] as const;
