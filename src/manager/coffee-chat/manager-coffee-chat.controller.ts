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
  NotificationDeliveryLookupDto,
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

  /** 알림톡의 카카오 최종 결과를 지금 알리고에서 조회 (CRB-77). 결과가 나왔으면 저장 */
  @Post("/notification-log/:pk/delivery-lookup")
  @HttpCode(200)
  @ApiErrors({
    400: "pk 형식 오류, 알리고 접수에 성공한 알림톡이 아님",
    404: "없는 로그",
    502: "알리고 조회 실패",
  })
  async lookupDelivery(
    @Param("pk", ParseUUIDPipe) pk: string,
  ): Promise<NotificationDeliveryLookupDto> {
    return this.coffeeChatService.lookupDelivery(pk);
  }
}
