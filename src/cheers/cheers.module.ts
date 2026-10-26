import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { ConfigModule } from "@src/config/config.module";
import { DatabaseModule } from "@src/database/database.module";
import { NotificationModule } from "@src/notification/notification.module";
import { CheersStudentController } from "./cheers-student.controller";
import { CheersStudentService } from "./cheers-student.service";

// 커피챗. 현업자 쪽(받은 요청 · 연락처 공유) 컨트롤러도 이 모듈에 추가
@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, NotificationModule],
  controllers: [CheersStudentController],
  providers: [CheersStudentService],
})
export class CheersModule {}
