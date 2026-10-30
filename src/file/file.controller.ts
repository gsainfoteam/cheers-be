import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { AnyStatusGuard } from "@src/auth/guard/any-status.guard";
import { UserGuard } from "@src/auth/guard/user.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import { ApiAuth, ApiErrors } from "@src/global/swagger/api-response.decorator";
import {
  UploadUrlRequestDto,
  UploadUrlResponseDto,
} from "./dto/upload-url.dto";
import { FilePurpose } from "./file.constants";
import { FileService } from "./file.service";

@ApiTags("파일")
@ApiAuth()
@Controller("/api/v1/file")
export class FileController {
  constructor(private readonly fileService: FileService) {}

  /** 명함 업로드용 presigned PUT URL 발급 */
  // 명함 인증은 가입 단계라 가입 중(pending)인 현업자도 호출
  @Post("/business-card/upload-url")
  @UseGuards(AnyStatusGuard, UserTypeGuard)
  @UserTypes(["graduated"])
  @ApiErrors({
    400: "요청 형식 오류, 허용되지 않은 파일 형식",
    403: "현업자가 아님",
    413: "파일 크기 초과",
  })
  async createBusinessCardUploadUrl(
    @Body() req: UploadUrlRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<UploadUrlResponseDto> {
    return this.createUploadUrl(user, FilePurpose.BUSINESS_CARD, req);
  }

  /** 이력서 · 포트폴리오 업로드용 presigned PUT URL 발급 */
  // 이력서 · 포트폴리오는 가입을 마친(active) 재학생만
  @Post("/attachment/upload-url")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
  @ApiErrors({
    400: "요청 형식 오류, 허용되지 않은 파일 형식",
    403: "가입을 마치지 않음, 재학생이 아님",
    413: "파일 크기 초과",
  })
  async createAttachmentUploadUrl(
    @Body() req: UploadUrlRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<UploadUrlResponseDto> {
    return this.createUploadUrl(user, FilePurpose.ATTACHMENT, req);
  }

  private async createUploadUrl(
    user: UserContext,
    purpose: FilePurpose,
    req: UploadUrlRequestDto,
  ): Promise<UploadUrlResponseDto> {
    const { url, key, headers, expiresIn } =
      await this.fileService.createUploadUrl(
        user.userPk,
        purpose,
        req.content_type,
        req.size,
      );
    return { url, method: "PUT", key, headers, expires_in: expiresIn };
  }
}
