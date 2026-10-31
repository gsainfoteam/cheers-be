import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import {
  ConsentStatusDto,
  ConsentTypeDto,
  ConsentVersionDto,
  ConsentVersionParamDto,
  CreateConsentVersionRequestDto,
} from "@src/manager/consent/dto/manager-consent.dto";
import { ManagerConsentService } from "@src/manager/consent/manager-consent.service";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { SuperAdminGuard } from "@src/manager/guard/super-admin.guard";

// 기존 버전은 수정 · 삭제하지 않고 새 버전으로 개정 (user_consent가 (type, version)을 참조)
@ApiTags("이용약관 관리")
@ApiAuth()
@Controller("/api/manager/v1/consent")
@UseGuards(ManagerGuard)
export class ManagerConsentController {
  constructor(private readonly managerConsentService: ManagerConsentService) {}

  /** 약관 종류별 버전 목록 */
  @Get()
  async list(): Promise<ConsentTypeDto[]> {
    return this.managerConsentService.list();
  }

  /** 약관 새 버전 등록 (superadmin 전용). 필수 약관이면 동의하지 않은 사용자에게 재동의를 요구함 */
  @Post()
  @UseGuards(SuperAdminGuard)
  @ApiErrors({
    400: "요청 형식 오류",
    403: "superadmin이 아님",
    409: "이미 있는 버전",
  })
  async create(
    @Body() req: CreateConsentVersionRequestDto,
  ): Promise<ConsentVersionDto> {
    return this.managerConsentService.create(req);
  }

  /** 버전별 동의 · 철회 현황 */
  @Get("/:type/:version/status")
  @ApiErrors({
    400: "요청 형식 오류",
    404: "없는 버전",
  })
  async getStatus(
    @Param() params: ConsentVersionParamDto,
  ): Promise<ConsentStatusDto> {
    return this.managerConsentService.getStatus(params.type, params.version);
  }
}
