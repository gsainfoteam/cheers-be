import { Module } from "@nestjs/common";
import { ManagerConsentController } from "@src/manager/consent/manager-consent.controller";
import { ManagerConsentService } from "@src/manager/consent/manager-consent.service";
import { ManagerModule } from "@src/manager/manager.module";

@Module({
  imports: [ManagerModule],
  controllers: [ManagerConsentController],
  providers: [ManagerConsentService],
})
export class ManagerConsentModule {}
