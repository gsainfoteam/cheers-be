import { AdminRepositoryModule } from "@src/admin-repository/admin-repository.module";
import { CompanyImportService } from "./company-import.service";
import { Module } from "@nestjs/common";
import { CompanyModule } from "@src/company/company.module";
import { DatabaseModule } from "@src/database/database.module";
import { FileModule } from "@src/file/file.module";
import { AdminCompanyController } from "@src/manager/company/admin-company.controller";
import { AdminCompanyService } from "@src/manager/company/admin-company.service";
import { ManagerModule } from "@src/manager/manager.module";

@Module({
  imports: [
    AdminRepositoryModule,
    DatabaseModule,
    ManagerModule,
    FileModule,
    CompanyModule,
  ],
  controllers: [AdminCompanyController],
  providers: [AdminCompanyService, CompanyImportService],
})
export class AdminCompanyModule {}
