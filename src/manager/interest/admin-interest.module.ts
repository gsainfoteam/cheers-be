import { Module } from "@nestjs/common";
import { DatabaseModule } from "@src/database/database.module";
import { AdminInterestController } from "@src/manager/interest/admin-interest.controller";
import { AdminInterestService } from "@src/manager/interest/admin-interest.service";
import { ManagerModule } from "@src/manager/manager.module";
import { StudentModule } from "@src/student/student.module";

@Module({
  // InterestService는 GET /interests가 읽는 캐시와 같은 인스턴스여야 하므로 StudentModule에서 가져옴
  imports: [DatabaseModule, ManagerModule, StudentModule],
  controllers: [AdminInterestController],
  providers: [AdminInterestService],
})
export class AdminInterestModule {}
