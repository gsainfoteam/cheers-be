import { Module } from "@nestjs/common";
import { DatabaseModule } from "@src/database/database.module";
import { ManagerCoffeeChatController } from "@src/manager/coffee-chat/manager-coffee-chat.controller";
import { ManagerCoffeeChatService } from "@src/manager/coffee-chat/manager-coffee-chat.service";
import { ManagerModule } from "@src/manager/manager.module";
import { NotificationModule } from "@src/notification/notification.module";

@Module({
  imports: [DatabaseModule, ManagerModule, NotificationModule],
  controllers: [ManagerCoffeeChatController],
  providers: [ManagerCoffeeChatService],
})
export class ManagerCoffeeChatModule {}
