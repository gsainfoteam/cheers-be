import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "@src/global/logger/logger.module";

@Module({
  imports: [ConfigModule, LoggerModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
