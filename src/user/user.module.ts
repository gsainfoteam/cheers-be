import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { ConfigModule } from "@src/config/config.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { AppleVerifier } from "@src/user/oauth/apple.verifier";
import { GoogleVerifier } from "@src/user/oauth/google.verifier";
import { NaverVerifier } from "@src/user/oauth/naver.verifier";
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
    GoogleVerifier,
    AppleVerifier,
    NaverVerifier,
  ],
})
export class UserModule {}
