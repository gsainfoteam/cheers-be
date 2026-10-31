import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminRepositoryModule } from "@src/admin-repository/admin-repository.module";
import { AuthModule } from "@src/auth/auth.module";
import { ConfigModule } from "@src/config/config.module";
import { AdminAccountController } from "@src/manager/admin-account.controller";
import { AdminAccountService } from "@src/manager/admin-account.service";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { SuperAdminGuard } from "@src/manager/guard/super-admin.guard";
import { InfoteamIdpService } from "@src/manager/infoteam-idp.service";
import { ManagerAuthController } from "@src/manager/manager-auth.controller";
import { ManagerAuthService } from "@src/manager/manager-auth.service";

const guards = [ManagerGuard, SuperAdminGuard];

// 어드민 관리 기능 모듈에서 가드를 쓰려면 이 모듈을 import (가드가 쓰는 레포지토리 모듈도 같이 내보냄)
@Module({
  imports: [
    ConfigModule,
    AdminRepositoryModule,
    AuthModule,
    JwtModule.register({}),
  ],
  controllers: [ManagerAuthController, AdminAccountController],
  providers: [
    InfoteamIdpService,
    ManagerAuthService,
    AdminAccountService,
    ...guards,
  ],
  exports: [AdminRepositoryModule, ManagerAuthService, ...guards],
})
export class ManagerModule {}
