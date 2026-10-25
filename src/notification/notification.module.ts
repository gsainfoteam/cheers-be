import { Module } from "@nestjs/common";
import { ConfigModule } from "@src/config/config.module";
import { DatabaseModule } from "@src/database/database.module";
import { MailModule } from "@src/mail/mail.module";
import { AlimtalkService } from "./alimtalk.service";
import { NotificationLogRepository } from "./notification-log.repository";
import { NotificationService } from "./notification.service";

@Module({
  imports: [ConfigModule, DatabaseModule, MailModule],
  providers: [AlimtalkService, NotificationLogRepository, NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
