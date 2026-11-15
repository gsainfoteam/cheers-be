import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PageResponseDto } from "@src/cheers/dto/pagination.dto";
import {
  ApiAuth,
  ApiErrors,
  ApiPageResponse,
} from "@src/global/swagger/api-response.decorator";
import { ManagerContext } from "@src/manager/context/manager-context";
import { CurrentManager } from "@src/manager/decorator/current-manager.decorator";
import { ManagerGuard } from "@src/manager/guard/manager.guard";
import {
  UserContactDto,
  UserDetailDto,
  UserListItemDto,
  UserListQueryDto,
} from "@src/manager/user/dto/manager-user.dto";
import { ManagerUserService } from "@src/manager/user/manager-user.service";

@ApiTags("어드민 회원")
@ApiAuth()
@Controller("/api/manager/v1/user")
@UseGuards(ManagerGuard)
export class ManagerUserController {
  constructor(private readonly userService: ManagerUserService) {}

  /** 회원 목록 (가입 최신순) */
  @Get()
  @ApiPageResponse(UserListItemDto)
  @ApiErrors({ 400: "query 형식 오류, created_from이 created_to보다 늦음" })
  async listUsers(
    @Query() query: UserListQueryDto,
  ): Promise<PageResponseDto<UserListItemDto>> {
    return this.userService.listUsers(query);
  }

  /** 회원 상세. 연락처 값은 포함하지 않음 */
  @Get("/:pk")
  @ApiErrors({ 400: "pk 형식 오류", 404: "없는 회원" })
  async getUser(
    @Param("pk", ParseUUIDPipe) pk: string,
  ): Promise<UserDetailDto> {
    return this.userService.getUser(pk);
  }

  /** 커피챗 연락처 값 조회 (열람 기록을 남김) */
  @Get("/:pk/contact")
  @ApiErrors({
    400: "pk 형식 오류",
    404: "없는 회원, 탈퇴 처리 완료, 연락수단 미입력",
    500: "열람 기록 저장 실패 (값을 내려주지 않음)",
  })
  async getContact(
    @Param("pk", ParseUUIDPipe) pk: string,
    @CurrentManager() manager: ManagerContext,
  ): Promise<UserContactDto> {
    return this.userService.getContact(pk, manager);
  }
}
