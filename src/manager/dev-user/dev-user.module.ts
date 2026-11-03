import { Module } from "@nestjs/common";
import { ConfigModule } from "@src/config/config.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { ManagerModule } from "@src/manager/manager.module";
import { DevUserDeleteEnabledGuard } from "./dev-user-delete-enabled.guard";
import { DevUserController } from "./dev-user.controller";
import { DevUserService } from "./dev-user.service";

@Module({
  imports: [ConfigModule, DatabaseModule, FileModule, ManagerModule],
  controllers: [DevUserController],
  providers: [DevUserService, DevUserDeleteEnabledGuard],
})
export class DevUserModule {}
