import { Controller, Get } from "@nestjs/common";
import { BaseResultDto } from "@src/global/dto/base-result.dto";

@Controller()
export class AppController {
  @Get("health")
  health(): BaseResultDto {
    return BaseResultDto.OK;
  }
}
