import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { ConfigModule } from "@src/config/config.module";
import { FileController } from "./file.controller";
import { FileService } from "./file.service";

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
