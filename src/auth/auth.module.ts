import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule } from "@src/config/config.module";
import { DatabaseModule } from "@src/database/database.module";
import { AuthService } from "@src/auth/auth.service";
import { JwtKeyService } from "@src/auth/jwt-key.service";
import { SignupStepService } from "@src/auth/signup-step.service";
import { UserGuard } from "@src/auth/guard/user.guard";
import { AnyStatusGuard } from "@src/auth/guard/any-status.guard";
import { SignupStepGuard } from "@src/auth/guard/signup-step.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";

const guards = [UserGuard, AnyStatusGuard, SignupStepGuard, UserTypeGuard];

// 가드를 쓰는 기능 모듈에서 import
@Module({
  imports: [ConfigModule, DatabaseModule, JwtModule.register({})],
  providers: [AuthService, JwtKeyService, SignupStepService, ...guards],
  exports: [AuthService, JwtKeyService, SignupStepService, ...guards],
})
export class AuthModule {}
