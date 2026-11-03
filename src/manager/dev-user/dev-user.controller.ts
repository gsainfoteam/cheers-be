import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  PageResponseDto,
  PaginationQueryDto,
} from "@src/cheers/dto/pagination.dto";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import {
  ApiAuth,
  ApiErrors,
  ApiPageResponse,
} from "@src/global/swagger/api-response.decorator";
import { ManagerContext } from "@src/manager/context/manager-context";
import { CurrentManager } from "@src/manager/decorator/current-manager.decorator";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { SuperAdminGuard } from "@src/manager/guard/super-admin.guard";
import { DevUserDeleteEnabledGuard } from "./dev-user-delete-enabled.guard";
import { DevUserService } from "./dev-user.service";
import { DevUserDto } from "./dto/dev-user.dto";

// 개발 · QA용 (CRB-72). DEV_USER_DELETE_ENABLED=true가 아니면 두 API 모두 404
@ApiTags("개발용 회원 완전탈퇴")
@ApiAuth()
@Controller("/api/manager/v1/dev/user")
@UseGuards(DevUserDeleteEnabledGuard, ManagerGuard, SuperAdminGuard)
export class DevUserController {
  constructor(private readonly devUserService: DevUserService) {}

  /** 회원 목록 (최근 가입 순, 탈퇴 처리 완료 포함, superadmin 전용) */
  @Get()
  @ApiPageResponse(DevUserDto)
  @ApiErrors({
    400: "query 형식 오류",
    403: "superadmin이 아님",
    404: "DEV_USER_DELETE_ENABLED가 꺼진 환경",
  })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<PageResponseDto<DevUserDto>> {
    return this.devUserService.list(query);
  }

  /** 회원 완전탈퇴 (유예 없이 유저와 하위 데이터 · 첨부 · 명함 파일 삭제, superadmin 전용) */
  @Delete("/:userPk")
  @ApiErrors({
    400: "userPk가 UUID 형식이 아님",
    403: "superadmin이 아님",
    404: "없는 유저, DEV_USER_DELETE_ENABLED가 꺼진 환경",
  })
  async delete(
    @Param("userPk", ParseUUIDPipe) userPk: string,
    @CurrentManager() manager: ManagerContext,
  ): Promise<BaseResultDto> {
    await this.devUserService.delete(userPk, manager);
    return BaseResultDto.OK;
  }
}
