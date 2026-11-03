/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IDP_AUTHORIZE_URL: string;
  readonly VITE_IDP_CLIENT_ID: string;
  // "true"일 때만 개발용 회원 완전탈퇴 메뉴를 보여 줌 (staging 이미지)
  readonly VITE_DEV_USER_DELETE_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
