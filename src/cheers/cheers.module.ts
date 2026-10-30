import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { ConfigModule } from "@src/config/config.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { NotificationModule } from "@src/notification/notification.module";
import { CheersGraduatedController } from "./cheers-graduated.controller";
import { CheersGraduatedService } from "./cheers-graduated.service";
import { CheersStudentController } from "./cheers-student.controller";
import { CheersStudentService } from "./cheers-student.service";

// 커피챗 (재학생 쪽 · 현업자 쪽)
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    FileModule,
    NotificationModule,
  ],
  controllers: [CheersStudentController, CheersGraduatedController],
  providers: [CheersStudentService, CheersGraduatedService],
})
export class CheersModule {}
