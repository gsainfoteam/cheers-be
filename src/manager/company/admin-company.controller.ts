import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import { CompanyService } from "@src/company/company.service";
import {
  CompanySearchItemDto,
  CompanySearchQueryDto,
} from "@src/company/dto/company-search.dto";
import {
  UploadUrlRequestDto,
  UploadUrlResponseDto,
} from "@src/file/dto/upload-url.dto";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import {
  ApiAuth,
  ApiErrors,
  ApiPageResponse,
} from "@src/global/swagger/api-response.decorator";
import { ManagerContext } from "@src/manager/context/manager-context";
import { CurrentManager } from "@src/manager/decorator/current-manager.decorator";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { AdminCompanyService } from "./admin-company.service";
import {
  AdminCompanyDto,
  AdminCompanyListQueryDto,
  AdminCompanyNameRequestDto,
  CreateAdminCompanyRequestDto,
  MergeAdminCompanyRequestDto,
  UpdateAdminCompanyLogoRequestDto,
  UpdateAdminCompanyRequestDto,
} from "./dto/admin-company.dto";
import { CompanyImportService } from "./company-import.service";
import {
  COMPANY_IMPORT_MAX_BYTES,
  CompanyImportFile,
} from "./company-import.parser";
import { CompanyImportResultDto } from "./dto/company-import.dto";
import { ParseCompanyPkPipe } from "./parse-company-pk.pipe";

// 회사(alias) · 표기(name) · 로고 관리, 현업자가 직접 입력한 회사 검토 (CRB-68)
@ApiTags("회사")
@ApiAuth()
@Controller("/api/manager/v1/company")
@UseGuards(ManagerGuard)
export class AdminCompanyController {
  constructor(
    private readonly adminCompanyService: AdminCompanyService,
    private readonly companyService: CompanyService,
    private readonly companyImportService: CompanyImportService,
  ) {}

  /** 회사 목록 (검토가 필요한 회사가 맨 위, 그다음 최근 등록 순) */
  @Get()
  @ApiPageResponse(AdminCompanyDto)
  @ApiErrors({ 400: "query 형식 오류" })
  async list(
    @Query() query: AdminCompanyListQueryDto,
  ): Promise<PageResponseDto<AdminCompanyDto>> {
    return this.adminCompanyService.list(query);
  }

  /** 현업자 입력창의 회사 검색과 같은 결과 (GET /api/v1/company 미리보기) */
  @Get("/search")
  @ApiErrors({ 400: "query 형식 오류" })
  async search(
    @Query() query: CompanySearchQueryDto,
  ): Promise<CompanySearchItemDto[]> {
    return this.companyService.search(query.q);
  }

  /** 회사 미리 등록 (회사 이름 + 다른 표기) */
  @Post()
  @ApiErrors({
    400: "요청 형식 오류",
    409: "이미 다른 회사에 등록된 표기",
  })
  async create(
    @Body() req: CreateAdminCompanyRequestDto,
  ): Promise<AdminCompanyDto> {
    return this.adminCompanyService.create(req);
  }

  /** 로고 업로드용 presigned PUT URL 발급 (png · jpeg · webp, 2MB) */
  @Post("/logo/upload-url")
  @ApiErrors({
    400: "요청 형식 오류, 허용되지 않은 파일 형식",
    413: "파일 크기 초과",
  })
  async createLogoUploadUrl(
    @Body() req: UploadUrlRequestDto,
    @CurrentManager() manager: ManagerContext,
  ): Promise<UploadUrlResponseDto> {
    return this.adminCompanyService.createLogoUploadUrl(
      manager.pk,
      req.content_type,
      req.size,
    );
  }

  /** 회사 · 표기 일괄 등록 미리보기 (DB에 저장하지 않음) */
  @Post("/import/preview")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          format: "binary",
          description:
            ".xlsx 또는 UTF-8 .csv (company name, alias1, alias2, …), 최대 1000행 · 별칭 50개 · 2MB",
        },
      },
    },
  })
  @ApiErrors({
    400: "파일 누락, 파일 형식 · 헤더 오류, 행 · 열 제한 초과",
    413: "파일 크기 초과",
  })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: COMPANY_IMPORT_MAX_BYTES } }),
  )
  async previewImport(
    @UploadedFile() file: CompanyImportFile,
  ): Promise<CompanyImportResultDto> {
    return this.companyImportService.preview(file);
  }

  /** 회사 · 표기 일괄 등록 (전체 검증 후 한 번에 저장) */
  @Post("/import")
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          format: "binary",
          description:
            ".xlsx 또는 UTF-8 .csv (company name, alias1, alias2, …), 최대 1000행 · 별칭 50개 · 2MB",
        },
      },
    },
  })
  @ApiErrors({
    400: "파일 형식 오류 또는 표기 충돌 (전체 등록 취소)",
    409: "동시 변경으로 재시도 필요",
    413: "파일 크기 초과",
  })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: COMPANY_IMPORT_MAX_BYTES } }),
  )
  async importCompanies(
    @UploadedFile() file: CompanyImportFile,
  ): Promise<CompanyImportResultDto> {
    return this.companyImportService.commit(file);
  }

  /** 회사 이름 변경 · 검토 완료 */
  @Patch("/:pk")
  @ApiErrors({
    400: "요청 형식 오류",
    404: "없는 회사",
    409: "새 이름이 이미 다른 회사에 등록된 표기",
  })
  async update(
    @Param("pk", ParseCompanyPkPipe) pk: number,
    @Body() req: UpdateAdminCompanyRequestDto,
  ): Promise<AdminCompanyDto> {
    return this.adminCompanyService.update(pk, req);
  }

  /** 회사 삭제 (고른 현업자가 없을 때만) */
  @Delete("/:pk")
  @ApiErrors({
    400: "pk 형식 오류",
    404: "없는 회사",
    409: "현업자가 고른 회사 (병합으로 처리)",
  })
  async remove(
    @Param("pk", ParseCompanyPkPipe) pk: number,
  ): Promise<BaseResultDto> {
    await this.adminCompanyService.remove(pk);
    return BaseResultDto.OK;
  }

  /** 표기 추가 */
  @Post("/:pk/name")
  @ApiErrors({
    400: "요청 형식 오류",
    404: "없는 회사",
    409: "이미 등록된 표기",
  })
  async addName(
    @Param("pk", ParseCompanyPkPipe) pk: number,
    @Body() req: AdminCompanyNameRequestDto,
  ): Promise<AdminCompanyDto> {
    return this.adminCompanyService.addName(pk, req.name);
  }

  /** 표기 삭제 (회사 이름 표기는 삭제 불가) */
  @Delete("/:pk/name/:namePk")
  @ApiErrors({
    400: "pk 형식 오류, 회사 이름 표기",
    404: "없는 회사, 이 회사의 표기가 아님",
  })
  async removeName(
    @Param("pk", ParseCompanyPkPipe) pk: number,
    @Param("namePk", ParseCompanyPkPipe) namePk: number,
  ): Promise<AdminCompanyDto> {
    return this.adminCompanyService.removeName(pk, namePk);
  }

  /** 회사 병합: 이 회사의 표기 · 현업자를 target_id 회사로 옮기고 이 회사를 삭제 */
  @Post("/:pk/merge")
  @HttpCode(200)
  @ApiErrors({
    400: "요청 형식 오류, 자기 자신으로 병합",
    404: "없는 회사",
  })
  async merge(
    @Param("pk", ParseCompanyPkPipe) pk: number,
    @Body() req: MergeAdminCompanyRequestDto,
  ): Promise<AdminCompanyDto> {
    return this.adminCompanyService.merge(pk, req.target_id);
  }

  /** 업로드한 로고 확정 · 연결 (이전 로고 대체) */
  @Put("/:pk/logo")
  @ApiErrors({
    400: "요청 형식 오류, 내가 발급받은 key가 아님, 업로드되지 않음, 허용 범위를 벗어난 파일",
    404: "없는 회사",
  })
  async updateLogo(
    @Param("pk", ParseCompanyPkPipe) pk: number,
    @Body() req: UpdateAdminCompanyLogoRequestDto,
    @CurrentManager() manager: ManagerContext,
  ): Promise<BaseResultDto> {
    await this.adminCompanyService.updateLogo(pk, req.key, manager.pk);
    return BaseResultDto.OK;
  }
}
