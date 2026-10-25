import { IsNotEmpty, IsString } from "class-validator";

export class LogoutRequestDto {
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}
