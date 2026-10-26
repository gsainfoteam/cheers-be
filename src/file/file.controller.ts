import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { UserContext } from "@src/auth/context/user-context";
import { CurrentUser } from "@src/auth/decorator/current-user.decorator";
import { UserTypes } from "@src/auth/decorator/user-types.decorator";
import { AnyStatusGuard } from "@src/auth/guard/any-status.guard";
import { UserGuard } from "@src/auth/guard/user.guard";
import { UserTypeGuard } from "@src/auth/guard/user-type.guard";
import {
  UploadUrlRequestDto,
  UploadUrlResponseDto,
} from "./dto/upload-url.dto";
import { FilePurpose } from "./file.constants";
import { FileService } from "./file.service";

@Controller("/api/v1/file")
export class FileController {
  constructor(private readonly fileService: FileService) {}

  // 명함 인증은 가입 단계라 가입 중(pending)인 현업자도 호출
  @Post("/business-card/upload-url")
  @UseGuards(AnyStatusGuard, UserTypeGuard)
  @UserTypes(["graduated"])
  async createBusinessCardUploadUrl(
    @Body() req: UploadUrlRequestDto,
    @CurrentUser() user: UserContext,
  ): Promise<UploadUrlResponseDto> {
    return this.createUploadUrl(user, FilePurpose.BUSINESS_CARD, req);
  }

  // 이력서 · 포트폴리오는 가입을 마친(active) 재학생만
  @Post("/attachment/upload-url")
  @UseGuards(UserGuard, UserTypeGuard)
  @UserTypes(["student"])
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
