import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import { AdminAccountService } from "@src/manager/admin-account.service";
import { ManagerContext } from "@src/manager/context/manager-context";
import { CurrentManager } from "@src/manager/decorator/current-manager.decorator";
import {
  AdminAccountDto,
  CreateAdminAccountRequestDto,
  UpdateAdminAccountRoleRequestDto,
} from "@src/manager/dto/admin-account.dto";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { SuperAdminGuard } from "@src/manager/guard/super-admin.guard";

@ApiTags("어드민 계정")
@ApiAuth()
@Controller("/api/manager/v1/admin-account")
@UseGuards(ManagerGuard)
export class AdminAccountController {
  constructor(private readonly adminAccountService: AdminAccountService) {}

  /** 어드민 계정 목록 */
  @Get()
  async list(): Promise<AdminAccountDto[]> {
    return this.adminAccountService.list();
  }

  /** 어드민 계정 등록 (superadmin 전용) */
  @Post()
  @UseGuards(SuperAdminGuard)
  @ApiErrors({
    400: "요청 형식 오류, @gm.gist.ac.kr이 아닌 이메일",
    403: "superadmin이 아님",
    409: "이미 등록된 이메일",
  })
  async create(
    @Body() req: CreateAdminAccountRequestDto,
  ): Promise<AdminAccountDto> {
    return this.adminAccountService.create(req);
  }

  /** 어드민 권한 변경 (superadmin 전용, 자기 자신은 불가) */
  @Patch("/:pk")
  @UseGuards(SuperAdminGuard)
  @ApiErrors({
    400: "요청 형식 오류",
    403: "superadmin이 아님, 자기 자신",
    404: "없는 계정",
  })
  async updateRole(
    @Param("pk", ParseUUIDPipe) pk: string,
    @Body() req: UpdateAdminAccountRoleRequestDto,
    @CurrentManager() manager: ManagerContext,
  ): Promise<AdminAccountDto> {
    return this.adminAccountService.updateRole(pk, req, manager);
  }

  /** 어드민 계정 삭제 (superadmin 전용, 자기 자신 · superadmin은 불가) */
  @Delete("/:pk")
  @UseGuards(SuperAdminGuard)
  @ApiErrors({
    400: "요청 형식 오류",
    403: "superadmin이 아님, 자기 자신, 대상이 superadmin",
    404: "없는 계정",
  })
  async remove(
    @Param("pk", ParseUUIDPipe) pk: string,
    @CurrentManager() manager: ManagerContext,
  ): Promise<BaseResultDto> {
    await this.adminAccountService.remove(pk, manager);
    return BaseResultDto.OK;
  }
}
