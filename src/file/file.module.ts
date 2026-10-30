import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { ConfigModule } from "@src/config/config.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileController } from "./file.controller";
import { FileService } from "./file.service";
import { OrphanFileScheduler } from "./orphan-file.scheduler";
import { OrphanFileService } from "./orphan-file.service";

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule],
  controllers: [FileController],
  providers: [FileService, OrphanFileService, OrphanFileScheduler],
  exports: [FileService],
})
export class FileModule {}
