import { Module } from "@nestjs/common";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { ManagerModule } from "@src/manager/manager.module";
import { BusinessCardController } from "./business-card.controller";
import { BusinessCardService } from "./business-card.service";

@Module({
  imports: [DatabaseModule, FileModule, ManagerModule],
  controllers: [BusinessCardController],
  providers: [BusinessCardService],
})
export class BusinessCardModule {}
