import { Module } from "@nestjs/common";
import { ConfigModule } from "@src/config/config.module";
import { DatabaseModule } from "@src/database/database.module";
import { MailModule } from "@src/mail/mail.module";
import { AligoAlertStateRepository } from "./aligo-alert-state.repository";
import { AligoBalanceAlertScheduler } from "./aligo-balance-alert.scheduler";
import { AligoBalanceAlertService } from "./aligo-balance-alert.service";
import { AlimtalkTemplateCache } from "./alimtalk-template.cache";
import { AlimtalkTemplateRepository } from "./alimtalk-template.repository";
import { AlimtalkService } from "./alimtalk.service";
import { NotificationDeliverySyncScheduler } from "./notification-delivery-sync.scheduler";
import { NotificationDeliverySyncService } from "./notification-delivery-sync.service";
import { NotificationLogRepository } from "./notification-log.repository";
import { NotificationService } from "./notification.service";

@Module({
  imports: [ConfigModule, DatabaseModule, MailModule],
  providers: [
    AlimtalkService,
    AlimtalkTemplateRepository,
    AlimtalkTemplateCache,
    AligoAlertStateRepository,
    AligoBalanceAlertService,
    AligoBalanceAlertScheduler,
    NotificationLogRepository,
    NotificationService,
    NotificationDeliverySyncService,
    NotificationDeliverySyncScheduler,
  ],
  exports: [
    NotificationService,
    AlimtalkService,
    AlimtalkTemplateCache,
    AligoBalanceAlertService,
    NotificationLogRepository,
    NotificationDeliverySyncService,
  ],
})
export class NotificationModule {}
