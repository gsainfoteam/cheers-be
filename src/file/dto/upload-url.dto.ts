import { IsIn, IsInt, IsNotEmpty, IsPositive, IsString } from "class-validator";
import { FilePurpose } from "@src/file/file.constants";

export class UploadUrlRequestDto {
  @IsIn(Object.values(FilePurpose))
  purpose: FilePurpose;

  @IsString()
  @IsNotEmpty()
  content_type: string;

  // byte. 실제로 올릴 파일 크기와 같아야 함 (서명에 포함)
  @IsInt()
  @IsPositive()
  size: number;
}

export class UploadUrlResponseDto {
  url: string;
  method: "PUT";
  key: string;
  headers: Record<string, string>;
  expires_in: number;
}
