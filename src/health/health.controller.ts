import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { BaseResultDto } from "@src/global/dto/base-result.dto";
import { ErrorResponseDto } from "@src/global/dto/error-response.dto";
import { ApiErrors } from "@src/global/swagger/api-response.decorator";
import { HealthService } from "./health.service";

@ApiTags("상태 확인")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** 프로세스 생존 확인 (liveness). DB를 확인하지 않음 */
  @Get()
  live(): BaseResultDto {
    return BaseResultDto.OK;
  }

  /** 요청을 받을 수 있는지 확인 (readiness). DB 연결을 확인함 */
  @Get("ready")
  @ApiOkResponse({ type: BaseResultDto })
  @ApiErrors({ 503: "DB에 연결할 수 없음" })
  async ready(
    @Res({ passthrough: true }) response: Response,
  ): Promise<BaseResultDto | ErrorResponseDto> {
    if (await this.healthService.isReady()) {
      return BaseResultDto.OK;
    }

    // 예외를 던지면 AllExceptionsFilter가 probe마다 에러 로그를 남기므로 상태 코드만 설정
    response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: "Service Unavailable",
    };
  }
}
