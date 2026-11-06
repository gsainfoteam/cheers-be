import { Module } from "@nestjs/common";
import { CompanyModule } from "@src/company/company.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { AdminCompanyController } from "@src/manager/company/admin-company.controller";
import { AdminCompanyService } from "@src/manager/company/admin-company.service";
import { ManagerModule } from "@src/manager/manager.module";

@Module({
  imports: [DatabaseModule, ManagerModule, FileModule, CompanyModule],
  controllers: [AdminCompanyController],
  providers: [AdminCompanyService],
})
export class AdminCompanyModule {}
