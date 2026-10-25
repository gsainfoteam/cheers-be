import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { DatabaseModule } from "@src/database/database.module";
import { ConsentController } from "./consent.controller";
import { ConsentService } from "./consent.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ConsentController],
  providers: [ConsentService],
})
export class ConsentModule {}
