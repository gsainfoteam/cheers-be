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
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { UserGuard } from "@src/auth/guard/user.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { CheersStudentService } from "./cheers-student.service";
import {
  CreateRequestDto,
  CreateRequestResponseDto,
} from "./dto/create-request.dto";
import { CheersCardDto, GraduatedListQueryDto } from "./dto/graduated-list.dto";
import { PageResponseDto, PaginationQueryDto } from "./dto/pagination.dto";
import { SentRequestDetailDto, SentRequestDto } from "./dto/sent-request.dto";

// API 명세 "커피챗 · 재학생" 섹션. 가입을 마친 재학생만 (현업자 → 403).
// 현업자 쪽(/api/v1/cheers/received)은 별도 컨트롤러 (CRB-42)
@Controller("/api/v1/cheers")
export class CheersStudentController {
  constructor(private readonly cheersStudentService: CheersStudentService) {}

  @Get()
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
  async getGraduatedList(
    @Query() query: GraduatedListQueryDto,
  ): Promise<PageResponseDto<CheersCardDto>> {
    return this.cheersStudentService.getGraduatedList(query);
  }

  @Post("/request")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
  async createRequest(
    @Body() req: CreateRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<CreateRequestResponseDto> {
    return this.cheersStudentService.createRequest(user.userPk, req);
  }

  @Get("/sent")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
  async getSentList(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: UserContext,
  ): Promise<PageResponseDto<SentRequestDto>> {
    return this.cheersStudentService.getSentList(user.userPk, query);
  }

  @Get("/sent/:id")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
  async getSentDetail(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: UserContext,
  ): Promise<SentRequestDetailDto> {
    return this.cheersStudentService.getSentDetail(user.userPk, id);
  }
}
