import { Type } from "class-transformer";
import {
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
  @ValidateNested({ each: true })
  @Type(() => ConsentAgreementDto)
  consents: ConsentAgreementDto[];
}
