import { ConfigService } from "@nestjs/config";

// 개발용 회원 완전탈퇴(CRB-72)를 열지. 이미지에 NODE_ENV=production이 고정돼 있어 staging과 production을 env 값으로 구분.
// 빈 값은 미설정(꺼짐)으로 봄. 오타로 조용히 켜지거나 꺼지지 않도록 그 외 값은 서버가 뜨지 않게 막음
export function isDevUserDeleteEnabled(configService: ConfigService): boolean {
  const raw = configService.get<string>("DEV_USER_DELETE_ENABLED")?.trim();
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  throw new Error(
    `DEV_USER_DELETE_ENABLED must be true or false (got "${raw}").`,
  );
}
