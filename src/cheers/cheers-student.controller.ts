import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { UserGuard } from "@src/auth/guard/user.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import {
  ApiAuth,
  ApiErrors,
  ApiPageResponse,
} from "@src/global/swagger/api-response.decorator";
import { CheersStudentService } from "./cheers-student.service";
import {
  CreateRequestDto,
  CreateRequestResponseDto,
} from "./dto/create-request.dto";
import { CheersCardDto, GraduatedListQueryDto } from "./dto/graduated-list.dto";
import { PageResponseDto, PaginationQueryDto } from "./dto/pagination.dto";
import { SentRequestDetailDto, SentRequestDto } from "./dto/sent-request.dto";

// API 명세 "커피챗 · 재학생" 섹션. 가입을 마친 재학생만 (현업자 → 403).
// 현업자 쪽(/api/v1/cheers/received)은 CheersGraduatedController
@ApiTags("커피챗 · 재학생")
@ApiAuth()
@Controller("/api/v1/cheers")
export class CheersStudentController {
  constructor(private readonly cheersStudentService: CheersStudentService) {}

  /** 현업자 목록 */
  @Get()
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
  @ApiPageResponse(CheersCardDto)
  @ApiErrors({
    400: "query 형식 오류",
    403: "가입을 마치지 않음, 재학생이 아님",
  })
  async getGraduatedList(
    @Query() query: GraduatedListQueryDto,
  ): Promise<PageResponseDto<CheersCardDto>> {
    return this.cheersStudentService.getGraduatedList(query);
  }

  /** 커피챗 요청 보내기 */
  @Post("/request")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
  @ApiErrors({
    400: "요청 형식 오류",
    403: "가입을 마치지 않음, 재학생이 아님",
    404: "현업자를 찾을 수 없음 (탈퇴 · 탈퇴 유예기간 · 가입 미완료 포함)",
    409: "현업자가 연락 설정을 희망하지 않음으로 해둠",
  })
  async createRequest(
    @Body() req: CreateRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<CreateRequestResponseDto> {
    return this.cheersStudentService.createRequest(user.userPk, req);
  }

  /** 보낸 요청 목록 */
  @Get("/sent")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
  @ApiPageResponse(SentRequestDto)
  @ApiErrors({
    400: "query 형식 오류",
    403: "가입을 마치지 않음, 재학생이 아님",
  })
  async getSentList(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<PageResponseDto<SentRequestDto>> {
    return this.cheersStudentService.getSentList(user.userPk, query);
  }

  /** 보낸 요청 상세 */
  @Get("/sent/:id")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
  @ApiErrors({
    400: "id가 UUID 형식이 아님",
    403: "가입을 마치지 않음, 재학생이 아님",
    404: "요청이 없거나 내가 보낸 요청이 아님",
  })
  async getSentDetail(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: UserContext,
  ): Promise<SentRequestDetailDto> {
    return this.cheersStudentService.getSentDetail(user.userPk, id);
  }
}
