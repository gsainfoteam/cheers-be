import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from "class-validator";

export class ConsentAgreementDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  version: string;

  @IsBoolean()
  agreed: boolean;
}

export class UpdateConsentRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  // 약관 종류 수보다 넉넉하게
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConsentAgreementDto)
  consents: ConsentAgreementDto[];
}
