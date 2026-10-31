import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import { AdminInterestService } from "@src/manager/interest/admin-interest.service";
import {
  AdminInterestDto,
  AdminInterestNameRequestDto,
  ReorderAdminInterestRequestDto,
} from "@src/manager/interest/dto/admin-interest.dto";
import { ParseInterestPkPipe } from "@src/manager/interest/parse-interest-pk.pipe";

@ApiTags("관심 분야")
@ApiAuth()
@Controller("/api/manager/v1/interest")
@UseGuards(ManagerGuard)
export class AdminInterestController {
  constructor(private readonly adminInterestService: AdminInterestService) {}

  /** 관심 분야 목록 (sort_order 순) */
  @Get()
  async list(): Promise<AdminInterestDto[]> {
    return this.adminInterestService.list();
  }

  /** 관심 분야 추가 (맨 뒤에 붙음) */
  @Post()
  @ApiErrors({
    400: "빈 이름, 50자 초과",
    409: "이미 있는 이름",
  })
  async create(
    @Body() req: AdminInterestNameRequestDto,
  ): Promise<AdminInterestDto> {
    return this.adminInterestService.create(req);
  }

  /** 관심 분야 정렬 (전체 pk를 원하는 순서로 보냄) */
  @Put("/order")
  @ApiErrors({
    400: "빈 배열, 중복, 정수가 아닌 pk",
    409: "pks가 현재 목록과 다름 (그 사이 추가 · 삭제됨)",
  })
  async reorder(
    @Body() req: ReorderAdminInterestRequestDto,
  ): Promise<AdminInterestDto[]> {
    return this.adminInterestService.reorder(req);
  }

  /** 관심 분야 이름 수정 (이미 저장된 재학생 프로필의 값은 바뀌지 않음) */
  @Patch("/:pk")
  @ApiErrors({
    400: "잘못된 pk, 빈 이름, 50자 초과",
    404: "없는 관심 분야",
    409: "다른 항목이 쓰는 이름",
  })
  async updateName(
    @Param("pk", ParseInterestPkPipe) pk: number,
    @Body() req: AdminInterestNameRequestDto,
  ): Promise<AdminInterestDto> {
    return this.adminInterestService.updateName(pk, req);
  }

  /** 관심 분야 삭제 (이미 저장된 재학생 프로필의 값은 지워지지 않음) */
  @Delete("/:pk")
  @ApiErrors({
    400: "잘못된 pk",
    404: "없는 관심 분야",
  })
  async remove(
    @Param("pk", ParseInterestPkPipe) pk: number,
  ): Promise<BaseResultDto> {
    await this.adminInterestService.remove(pk);
    return BaseResultDto.OK;
  }
}
