import { Module } from "@nestjs/common";
import { ConfigModule } from "@src/config/config.module";
import { FileService } from "./file.service";

@Module({
  imports: [ConfigModule],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
