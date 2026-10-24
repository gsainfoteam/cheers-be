import { Module } from "@nestjs/common";
import { ConfigModule } from "@src/config/config.module";
import { LoggerService } from "@src/global/logger/logger.service";

@Module({
  imports: [ConfigModule],
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
