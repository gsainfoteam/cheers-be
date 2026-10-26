import { Matches } from "class-validator";

export class VerifyCodeRequestDto {
  @Matches(/^\d{6}$/, { message: "code must be 6 digits" })
  code: string;
}
