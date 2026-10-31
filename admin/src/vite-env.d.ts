/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IDP_AUTHORIZE_URL: string;
  readonly VITE_IDP_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
