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
import { CheersGraduatedService } from "./cheers-graduated.service";
import { PageResponseDto, PaginationQueryDto } from "./dto/pagination.dto";
import {
  ReceivedRequestDetailDto,
  ReceivedRequestDto,
  ShareContactResponseDto,
} from "./dto/received-request.dto";

// API 명세 "커피챗 · 현업자" 섹션. 가입을 마친 현업자만 (재학생 → 403)
@ApiTags("커피챗 · 현업자")
@ApiAuth()
@Controller("/api/v1/cheers/received")
export class CheersGraduatedController {
  constructor(
    private readonly cheersGraduatedService: CheersGraduatedService,
  ) {}

  /** 받은 요청 목록 */
  @Get()
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["graduated"])
  @ApiPageResponse(ReceivedRequestDto)
  @ApiErrors({
    400: "query 형식 오류",
    403: "가입을 마치지 않음, 현업자가 아님, 명함 인증이 취소됨",
  })
  async getReceivedList(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<PageResponseDto<ReceivedRequestDto>> {
    return this.cheersGraduatedService.getReceivedList(user.userPk, query);
  }

  /** 받은 요청 상세 */
  @Get("/:id")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["graduated"])
  @ApiErrors({
    400: "id가 UUID 형식이 아님",
    403: "가입을 마치지 않음, 현업자가 아님, 명함 인증이 취소됨",
    404: "요청이 없거나 내가 받은 요청이 아님",
    410: "재학생이 탈퇴했거나 탈퇴 유예기간 중",
  })
  async getReceivedDetail(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: UserContext,
  ): Promise<ReceivedRequestDetailDto> {
    return this.cheersGraduatedService.getReceivedDetail(user.userPk, id);
  }

  /** 내 연락처 공유 */
  // 다시 호출해도 처음 결과를 돌려주므로 새로 만드는 응답이 아님 (200)
  @Post("/:id/share-contact")
  @HttpCode(200)
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["graduated"])
  @ApiErrors({
    400: "id가 UUID 형식이 아님",
    403: "가입을 마치지 않음, 현업자가 아님, 명함 인증이 취소됨",
    404: "요청이 없거나 내가 받은 요청이 아님",
    409: "내 연락 설정이 희망하지 않음이라 공유할 연락처가 없음",
    410: "재학생이 탈퇴했거나 탈퇴 유예기간 중",
  })
  async shareContact(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: UserContext,
  ): Promise<ShareContactResponseDto> {
    return this.cheersGraduatedService.shareContact(user.userPk, id);
  }
}
