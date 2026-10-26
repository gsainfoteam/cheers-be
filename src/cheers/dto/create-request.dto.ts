import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";
import { MESSAGE_MAX_LENGTH } from "@src/cheers/cheers.constants";

export class CreateRequestDto {
  @IsUUID()
  graduated_id: string;

  // 질문 내용. 앞뒤 공백을 지운 뒤 검사
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  message: string;
}

export class CreateRequestResponseDto {
  id: string;
  created_at: string;
}
