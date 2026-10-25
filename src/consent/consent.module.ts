import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { DatabaseModule } from "@src/database/database.module";
import { ConsentController } from "./consent.controller";
import { ConsentRepository } from "./consent.repository";
import { ConsentService } from "./consent.service";

// 내 정보의 consent_required 계산용으로 ConsentService export
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ConsentController],
  providers: [ConsentRepository, ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
