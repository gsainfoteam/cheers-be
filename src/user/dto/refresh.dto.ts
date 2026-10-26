import { IsNotEmpty, IsString } from "class-validator";

export class RefreshRequestDto {
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}

export class RefreshResponseDto {
  access_token: string;
  refresh_token: string;
}
