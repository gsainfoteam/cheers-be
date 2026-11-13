import { Module } from "@nestjs/common";
import { ManagerModule } from "@src/manager/manager.module";
import { AdminAccessLogController } from "./admin-access-log.controller";
import { AdminAccessLogService } from "./admin-access-log.service";

@Module({
  imports: [ManagerModule],
  controllers: [AdminAccessLogController],
  providers: [AdminAccessLogService],
})
export class AdminAccessLogModule {}
