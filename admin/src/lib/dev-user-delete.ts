// 개발용 회원 완전탈퇴 메뉴 (CRB-72). 빌드 인자라 staging 이미지에만 들어감 (staging.yml).
// API는 서버 env DEV_USER_DELETE_ENABLED로 따로 막으므로 이 값은 메뉴 · 화면 노출만 정함
export const DEV_USER_DELETE_ENABLED =
  import.meta.env.VITE_DEV_USER_DELETE_ENABLED === "true";
