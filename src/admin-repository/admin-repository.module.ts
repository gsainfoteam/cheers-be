import { Module } from "@nestjs/common";
import { AdminAccessLogRepository } from "@src/admin-repository/admin-access-log.repository";
import { AdminAccountRepository } from "@src/admin-repository/admin-account.repository";
import { AdminGraduatedRepository } from "@src/admin-repository/admin-graduated.repository";
import { DatabaseModule } from "@src/database/database.module";

const repositories = [
  AdminAccountRepository,
  AdminAccessLogRepository,
  AdminGraduatedRepository,
];

// 어드민 API에서 쓰는 레포지토리. 앱 API용 src/database/repository와 섞지 않음.
// 기존 테이블을 어드민에서 조회 · 수정해야 하면 여기에 admin-{table}.repository.ts를 따로 만듦
@Module({
  imports: [DatabaseModule],
  providers: repositories,
  exports: repositories,
})
export class AdminRepositoryModule {}
