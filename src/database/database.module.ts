import { Module } from "@nestjs/common";
import { DatabaseService } from "./database.service";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "@src/global/logger/logger.module";
import { RefreshTokenRepository } from "@src/database/repository/refresh-token.repository";
import { UserRepository } from "@src/database/repository/user.repository";

@Module({
  imports: [ConfigModule, LoggerModule],
  providers: [DatabaseService, RefreshTokenRepository, UserRepository],
  exports: [DatabaseService, RefreshTokenRepository, UserRepository],
})
export class DatabaseModule {}
