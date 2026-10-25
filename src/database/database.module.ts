import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "@src/global/logger/logger.module";
import { RefreshTokenRepository } from "@src/database/repository/refresh-token.repository";
import { UserRepository } from "@src/database/repository/user.repository";
import { UserOauthAccountRepository } from "@src/database/repository/user-oauth-account.repository";
import { StudentRepository } from "@src/database/repository/student.repository";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { ConsentRepository } from "@src/database/repository/consent.repository";
import { UserConsentRepository } from "@src/database/repository/user-consent.repository";

const repositories = [
  RefreshTokenRepository,
  UserRepository,
  UserOauthAccountRepository,
  StudentRepository,
  GraduatedRepository,
  CoffeeChatContactRepository,
  ConsentRepository,
  UserConsentRepository,
];

@Module({
  imports: [ConfigModule, LoggerModule],
  providers: [DatabaseService, ...repositories],
  exports: [DatabaseService, ...repositories],
})
export class DatabaseModule {}
