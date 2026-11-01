import { Module } from "@nestjs/common";
import { DatabaseModule } from "@src/database/database.module";
import { SchoolDepartmentController } from "@src/manager/department/school-department.controller";
import { SchoolDepartmentService } from "@src/manager/department/school-department.service";
import { ManagerModule } from "@src/manager/manager.module";

@Module({
  imports: [DatabaseModule, ManagerModule],
  controllers: [SchoolDepartmentController],
  providers: [SchoolDepartmentService],
})
export class SchoolDepartmentModule {}
