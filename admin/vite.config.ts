import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 배포에서는 백엔드가 이 빌드 결과를 /admin 아래에 서빙함.
// vite dev에서는 /api를 로컬 백엔드로 넘겨 같은 origin으로 호출 (CORS 불필요)
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
