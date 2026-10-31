import { Module } from "@nestjs/common";
import { ManagerCoffeeChatController } from "@src/manager/coffee-chat/manager-coffee-chat.controller";
import { ManagerCoffeeChatService } from "@src/manager/coffee-chat/manager-coffee-chat.service";
import { ManagerModule } from "@src/manager/manager.module";

@Module({
  imports: [ManagerModule],
  controllers: [ManagerCoffeeChatController],
  providers: [ManagerCoffeeChatService],
})
export class ManagerCoffeeChatModule {}
