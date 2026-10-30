import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "@src/global/logger/logger.module";
import { RefreshTokenRepository } from "@src/database/repository/refresh-token.repository";
import { UserRepository } from "@src/database/repository/user.repository";
import { UserOauthAccountRepository } from "@src/database/repository/user-oauth-account.repository";
import { StudentRepository } from "@src/database/repository/student.repository";
import { StudentProfileRepository } from "@src/database/repository/student-profile.repository";
import { StudentProfileAttachmentRepository } from "@src/database/repository/student-profile-attachment.repository";
import { StudentEmailVerificationRepository } from "@src/database/repository/student-email-verification.repository";
import { StudentEmailSendLogRepository } from "@src/database/repository/student-email-send-log.repository";
import { GraduatedRepository } from "@src/database/repository/graduated.repository";
import { GraduatedProfileRepository } from "@src/database/repository/graduated-profile.repository";
import { CoffeeChatContactRepository } from "@src/database/repository/coffee-chat-contact.repository";
import { ConsentRepository } from "@src/database/repository/consent.repository";
import { UserConsentRepository } from "@src/database/repository/user-consent.repository";
import { SchoolRepository } from "@src/database/repository/school.repository";
import { DepartmentRepository } from "@src/database/repository/department.repository";
import { GraduatedCardRepository } from "@src/database/repository/graduated-card.repository";
import { CoffeeChatRequestRepository } from "@src/database/repository/coffee-chat-request.repository";
import { InterestRepository } from "@src/database/repository/interest.repository";
import { JwtSigningKeyRepository } from "@src/database/repository/jwt-signing-key.repository";

const repositories = [
  RefreshTokenRepository,
  UserRepository,
  UserOauthAccountRepository,
  StudentRepository,
  StudentProfileRepository,
  StudentProfileAttachmentRepository,
  StudentEmailVerificationRepository,
  StudentEmailSendLogRepository,
  GraduatedRepository,
  GraduatedProfileRepository,
  CoffeeChatContactRepository,
  ConsentRepository,
  UserConsentRepository,
  SchoolRepository,
  DepartmentRepository,
  GraduatedCardRepository,
  CoffeeChatRequestRepository,
  JwtSigningKeyRepository,
  InterestRepository,
];

@Module({
  imports: [ConfigModule, LoggerModule],
  providers: [DatabaseService, ...repositories],
  exports: [DatabaseService, ...repositories],
})
export class DatabaseModule {}
