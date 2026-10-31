import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import {
  CreateDepartmentRequestDto,
  DepartmentAdminDto,
  ReplaceEmailDomainsRequestDto,
  SchoolDto,
  UpdateDepartmentRequestDto,
} from "@src/manager/department/dto/school-department.dto";
import { ParsePkPipe } from "@src/manager/department/parse-pk.pipe";
import { SchoolDepartmentService } from "@src/manager/department/school-department.service";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { SuperAdminGuard } from "@src/manager/guard/super-admin.guard";

@ApiTags("학교 · 학과")
@ApiAuth()
@Controller("/api/manager/v1/school")
@UseGuards(ManagerGuard)
export class SchoolDepartmentController {
  constructor(private readonly service: SchoolDepartmentService) {}

  /** 학교 목록과 허용 이메일 도메인 */
  @Get()
  async listSchools(): Promise<SchoolDto[]> {
    return this.service.listSchools();
  }

  /** 학교별 학과 목록 (비활성 학과 포함) */
  @Get("/:schoolPk/department")
  @ApiErrors({
    400: "요청 형식 오류",
    404: "없는 학교",
  })
  async listDepartments(
    @Param("schoolPk", ParsePkPipe) schoolPk: number,
  ): Promise<DepartmentAdminDto[]> {
    return this.service.listDepartments(schoolPk);
  }

  /** 학과 추가 */
  @Post("/:schoolPk/department")
  @ApiErrors({
    400: "요청 형식 오류",
    404: "없는 학교",
    409: "같은 학교에 같은 이름의 학과가 있음 (비활성 학과 포함)",
  })
  async createDepartment(
    @Param("schoolPk", ParsePkPipe) schoolPk: number,
    @Body() req: CreateDepartmentRequestDto,
  ): Promise<DepartmentAdminDto> {
    return this.service.createDepartment(schoolPk, req);
  }

  /** 학과 이름 수정 · 비활성화 · 재활성화 */
  @Patch("/:schoolPk/department/:departmentPk")
  @ApiErrors({
    400: "요청 형식 오류, 바꿀 값이 없음",
    404: "없는 학과, 다른 학교의 학과",
    409: "같은 학교에 같은 이름의 학과가 있음 (비활성 학과 포함), 마지막 활성 학과를 비활성화",
  })
  async updateDepartment(
    @Param("schoolPk", ParsePkPipe) schoolPk: number,
    @Param("departmentPk", ParsePkPipe) departmentPk: number,
    @Body() req: UpdateDepartmentRequestDto,
  ): Promise<DepartmentAdminDto> {
    return this.service.updateDepartment(schoolPk, departmentPk, req);
  }

  /** 허용 이메일 도메인 전체 교체 (superadmin 전용) */
  @Put("/:schoolPk/email-domain")
  @UseGuards(SuperAdminGuard)
  @ApiErrors({
    400: "요청 형식 오류, 빈 목록, 도메인 형식 오류",
    403: "superadmin이 아님",
    404: "없는 학교",
    409: "인증을 마친 재학생이 있는 도메인을 뺌, 다른 학교의 도메인",
  })
  async replaceEmailDomains(
    @Param("schoolPk", ParsePkPipe) schoolPk: number,
    @Body() req: ReplaceEmailDomainsRequestDto,
  ): Promise<SchoolDto> {
    return this.service.replaceEmailDomains(schoolPk, req);
  }
}
