import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { MailModule } from "@src/mail/mail.module";
import { InterestService } from "./interest.service";
import { StudentController } from "./student.controller";
import { StudentService } from "./student.service";
import { StudentVerificationService } from "./student-verification.service";

@Module({
  imports: [DatabaseModule, AuthModule, MailModule, FileModule],
  controllers: [StudentController],
  providers: [StudentVerificationService, StudentService, InterestService],
  exports: [InterestService],
})
export class StudentModule {}
