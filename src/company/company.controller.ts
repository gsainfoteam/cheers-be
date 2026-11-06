import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SignupStep } from "@src/auth/decorator/signup-step.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { SignupStepGuard } from "@src/auth/guard/signup-step.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import { CompanyService } from "./company.service";
import {
  CompanySearchItemDto,
  CompanySearchQueryDto,
} from "./dto/company-search.dto";

// 현업자 추가 정보 입력(가입 중) · 마이페이지 수정에서 회사를 고를 때 호출
@ApiTags("회사")
@ApiAuth()
@Controller("/api/v1/company")
@UseGuards(SignupStepGuard, UserTypeGuard)
@UserTypes(["graduated"])
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  /** 회사 검색 (최대 10개) */
  @Get()
  @SignupStep({ step: "profile", allowActive: true })
  @ApiErrors({
    400: "query 형식 오류",
    403: "현업자가 아님, 가입 중인데 next_step이 profile이 아님",
  })
  async search(
    @Query() query: CompanySearchQueryDto,
  ): Promise<CompanySearchItemDto[]> {
    return this.companyService.search(query.q);
  }
}
