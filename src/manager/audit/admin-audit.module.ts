import { Module } from "@nestjs/common";
import { ManagerModule } from "@src/manager/manager.module";
import { AdminAuditLogController } from "./admin-audit-log.controller";
import { AdminAuditLogService } from "./admin-audit-log.service";

@Module({
  imports: [ManagerModule],
  controllers: [AdminAuditLogController],
  providers: [AdminAuditLogService],
})
export class AdminAuditModule {}
