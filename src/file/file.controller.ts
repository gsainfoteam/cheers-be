import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { AnyStatusGuard } from "@src/auth/guard/any-status.guard";
import {
  UploadUrlRequestDto,
  UploadUrlResponseDto,
} from "./dto/upload-url.dto";
import { FileService } from "./file.service";

@Controller("/api/v1/file")
export class FileController {
  constructor(private readonly fileService: FileService) {}

  // 가입 중(명함 인증 단계)에도 호출하므로 가입 상태와 관계없이 통과. 유저 유형은 purpose별로 서비스에서 확인
  @Post("/upload-url")
  @UseGuards(AnyStatusGuard)
  async createUploadUrl(
    @Body() req: UploadUrlRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<UploadUrlResponseDto> {
    const { url, key, headers, expiresIn } =
      await this.fileService.createUploadUrl(
        user,
        req.purpose,
        req.content_type,
        req.size,
      );
    return { url, method: "PUT", key, headers, expires_in: expiresIn };
  }
}
