import { Transform } from "class-transformer";
import { Matches } from "class-validator";
import { trim } from "@src/global/dto/transforms";

export class NicknameCheckQueryDto {
  /** 확인할 닉네임. POST /graduated/info 의 nickname 규칙과 동일 */
  @Transform(trim)
  @Matches(/^[가-힣A-Za-z0-9_]{2,10}$/, {
    message: "nickname must be 2-10 characters of Korean, letters, digits or _",
  })
  nickname: string;
}

export class NicknameCheckResponseDto {
  /** 사용 가능하면 true. 대소문자 구분 없이 이미 쓰는 닉네임이면 false */
  available: boolean;
}
