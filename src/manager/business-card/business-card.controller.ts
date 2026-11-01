import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { BusinessCardService } from "./business-card.service";
import {
  BusinessCardGraduatedDto,
  BusinessCardImageUrlDto,
} from "./dto/business-card.dto";

@ApiTags("현업자 명함")
@ApiAuth()
@Controller("/api/manager/v1/business-card")
@UseGuards(ManagerGuard)
export class BusinessCardController {
  constructor(private readonly businessCardService: BusinessCardService) {}

  /** 현업자 명함 현황 목록 */
  @Get()
  @ApiPageResponse(BusinessCardGraduatedDto)
  @ApiErrors({ 400: "query 형식 오류" })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<PageResponseDto<BusinessCardGraduatedDto>> {
    return this.businessCardService.list(query);
  }

  /** 명함 이미지 presigned GET URL 발급 (열람 기록을 남김) */
  @Get("/:graduatedPk")
  @ApiErrors({
    400: "graduatedPk가 UUID 형식이 아님",
    404: "없는 현업자, 명함이 없음",
    500: "열람 기록 저장 실패 (URL을 발급하지 않음)",
  })
  async getImageUrl(
    @Param("graduatedPk", ParseUUIDPipe) graduatedPk: string,
    @CurrentManager() manager: ManagerContext,
  ): Promise<BusinessCardImageUrlDto> {
    return this.businessCardService.getImageUrl(graduatedPk, manager);
  }

  /** 명함 인증 취소 (superadmin 전용). 현업자가 재업로드하면 다시 인증됨 */
  @Post("/:graduatedPk/cancel-verification")
  @HttpCode(200)
  @UseGuards(SuperAdminGuard)
  @ApiErrors({
    400: "graduatedPk가 UUID 형식이 아님",
    403: "superadmin이 아님",
    404: "없는 현업자",
    409: "인증된 상태가 아님",
  })
  async cancelVerification(
    @Param("graduatedPk", ParseUUIDPipe) graduatedPk: string,
    @CurrentManager() manager: ManagerContext,
  ): Promise<BaseResultDto> {
    await this.businessCardService.cancelVerification(graduatedPk, manager);
    return BaseResultDto.OK;
  }
}
