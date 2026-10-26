import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { GraduatedController } from "./graduated.controller";
import { GraduatedService } from "./graduated.service";

@Module({
  imports: [DatabaseModule, AuthModule, FileModule],
  controllers: [GraduatedController],
  providers: [GraduatedService],
})
export class GraduatedModule {}
