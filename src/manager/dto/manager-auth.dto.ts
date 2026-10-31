import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";
import { AdminAccountRole } from "@src/admin-repository/admin-account.repository";
import { ADMIN_ACCOUNT_ROLES } from "@src/manager/dto/admin-account.dto";

export class ManagerLoginRequestDto {
  /** IdP가 콜백으로 보낸 authorization code */
  @IsString()
  @IsNotEmpty()
  code: string;

  /** authorize 요청에 쓴 redirect_uri (같아야 함) */
  @IsString()
  @IsNotEmpty()
  redirect_uri: string;

  /** PKCE code_verifier */
  @IsString()
  @IsNotEmpty()
  code_verifier: string;
}

export class ManagerLoginResponseDto {
  /** 매니저 토큰 (1일). refresh token은 없음 */
  access_token: string;
}

export class ManagerMeResponseDto {
  email: string;

  /** DB의 현재 값 */
  @ApiProperty({ enum: ADMIN_ACCOUNT_ROLES })
  role: AdminAccountRole;
}
