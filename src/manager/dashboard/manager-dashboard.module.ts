import { Module } from "@nestjs/common";
import { ManagerDashboardController } from "@src/manager/dashboard/manager-dashboard.controller";
import { ManagerDashboardService } from "@src/manager/dashboard/manager-dashboard.service";
import { ManagerModule } from "@src/manager/manager.module";

@Module({
  imports: [ManagerModule],
  controllers: [ManagerDashboardController],
  providers: [ManagerDashboardService],
})
export class ManagerDashboardModule {}
