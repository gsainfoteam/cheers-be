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
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { UserGuard } from "@src/auth/guard/user.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { CheersGraduatedService } from "./cheers-graduated.service";
import { PageResponseDto, PaginationQueryDto } from "./dto/pagination.dto";
import {
  ReceivedRequestDetailDto,
  ReceivedRequestDto,
  ShareContactResponseDto,
} from "./dto/received-request.dto";

// API 명세 "커피챗 · 현업자" 섹션. 가입을 마친 현업자만 (재학생 → 403)
@Controller("/api/v1/cheers/received")
export class CheersGraduatedController {
  constructor(
    private readonly cheersGraduatedService: CheersGraduatedService,
  ) {}

  @Get()
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["graduated"])
  async getReceivedList(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<PageResponseDto<ReceivedRequestDto>> {
    return this.cheersGraduatedService.getReceivedList(user.userPk, query);
  }

  @Get("/:id")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["graduated"])
  async getReceivedDetail(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: UserContext,
  ): Promise<ReceivedRequestDetailDto> {
    return this.cheersGraduatedService.getReceivedDetail(user.userPk, id);
  }

  // 다시 호출해도 처음 결과를 돌려주므로 새로 만드는 응답이 아님 (200)
  @Post("/:id/share-contact")
  @HttpCode(200)
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["graduated"])
  async shareContact(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: UserContext,
  ): Promise<ShareContactResponseDto> {
    return this.cheersGraduatedService.shareContact(user.userPk, id);
  }
}
