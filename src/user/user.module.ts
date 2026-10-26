import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { ConfigModule } from "@src/config/config.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { GoogleVerifier } from "@src/user/oauth/google.verifier";
import { OAuthService } from "@src/user/oauth/oauth.service";
import { UserController } from "@src/user/user.controller";
import { UserService } from "@src/user/user.service";
import { WithdrawalScheduler } from "@src/user/withdrawal.scheduler";
import { WithdrawalService } from "@src/user/withdrawal.service";

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, FileModule],
  controllers: [UserController],
  providers: [
    UserService,
    WithdrawalService,
    WithdrawalScheduler,
    OAuthService,
    // Apple · Naver Verifier는 열 때 등록 (ENABLED_OAUTH_PROVIDERS)
    GoogleVerifier,
  ],
})
export class UserModule {}
