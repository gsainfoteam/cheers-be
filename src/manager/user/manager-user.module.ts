import { Module } from "@nestjs/common";
import { ManagerModule } from "@src/manager/manager.module";
import { ManagerUserController } from "@src/manager/user/manager-user.controller";
import { ManagerUserService } from "@src/manager/user/manager-user.service";

@Module({
  imports: [ManagerModule],
  controllers: [ManagerUserController],
  providers: [ManagerUserService],
})
export class ManagerUserModule {}
