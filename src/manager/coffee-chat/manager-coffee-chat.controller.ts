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
import {
  CoffeeChatRequestDetailDto,
  CoffeeChatRequestDto,
  CoffeeChatRequestListQueryDto,
  NotificationLogItemDto,
  NotificationLogListQueryDto,
} from "@src/manager/coffee-chat/dto/manager-coffee-chat.dto";
import { ManagerCoffeeChatService } from "@src/manager/coffee-chat/manager-coffee-chat.service";
import { ManagerGuard } from "@src/manager/guard/manager.guard";

@ApiTags("어드민 커피챗")
@ApiAuth()
@Controller("/api/manager/v1/coffee-chat")
@UseGuards(ManagerGuard)
export class ManagerCoffeeChatController {
  constructor(private readonly coffeeChatService: ManagerCoffeeChatService) {}

  /** 커피챗 요청 목록 (최근 요청 순) */
  @Get("/request")
  @ApiPageResponse(CoffeeChatRequestDto)
  @ApiErrors({ 400: "query 형식 오류, created_from이 created_to보다 늦음" })
  async listRequests(
    @Query() query: CoffeeChatRequestListQueryDto,
  ): Promise<PageResponseDto<CoffeeChatRequestDto>> {
    return this.coffeeChatService.listRequests(query);
  }

  /** 커피챗 요청 상세와 알림 발송 결과 */
  @Get("/request/:pk")
  @ApiErrors({ 400: "pk 형식 오류", 404: "없는 요청" })
  async getRequest(
    @Param("pk", ParseUUIDPipe) pk: string,
  ): Promise<CoffeeChatRequestDetailDto> {
    return this.coffeeChatService.getRequest(pk);
  }

  /** 알림 발송 결과 목록 (최근 발송 순) */
  @Get("/notification-log")
  @ApiPageResponse(NotificationLogItemDto)
  @ApiErrors({ 400: "query 형식 오류, created_from이 created_to보다 늦음" })
  async listNotificationLogs(
    @Query() query: NotificationLogListQueryDto,
  ): Promise<PageResponseDto<NotificationLogItemDto>> {
    return this.coffeeChatService.listNotificationLogs(query);
  }
}
