import { Module } from "@nestjs/common";
import { AuthModule } from "@src/auth/auth.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { CompanyController } from "./company.controller";
import { CompanyService } from "./company.service";

@Module({
  imports: [DatabaseModule, AuthModule, FileModule],
  controllers: [CompanyController],
  providers: [CompanyService],
  // 어드민 회사 화면의 검색 미리보기가 현업자 검색과 같은 결과를 내도록 같은 서비스를 씀
  exports: [CompanyService],
})
export class CompanyModule {}
