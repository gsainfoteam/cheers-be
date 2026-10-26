import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class VerifyBusinessCardRequestDto {
  // POST /api/v1/file/business-card/upload-url 에서 받은 tmp key
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  key: string;
}
