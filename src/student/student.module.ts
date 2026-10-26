import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { DatabaseModule } from "@src/database/database.module";
import { MailModule } from "@src/mail/mail.module";
import { StudentController } from "./student.controller";
import { StudentService } from "./student.service";
import { StudentVerificationService } from "./student-verification.service";

@Module({
  imports: [DatabaseModule, AuthModule, MailModule],
  controllers: [StudentController],
  providers: [StudentVerificationService, StudentService],
})
export class StudentModule {}
