import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BaseResultDto } from "@src/global/dto/base-result.dto";

@ApiTags("상태 확인")
@Controller()
export class AppController {
  /** 서버 상태 확인 */
  @Get("health")
  health(): BaseResultDto {
    return BaseResultDto.OK;
  }
}
