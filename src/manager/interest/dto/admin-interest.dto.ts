import { Transform } from "class-transformer";
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

// interest.pk는 integer 컬럼. 범위를 넘는 값은 DB 오류(500)가 되므로 먼저 400으로 막음
export const INTEREST_PK_MAX = 2147483647;

// 눈에 같은 이름이 따로 저장되지 않도록 앞뒤 공백을 지우고 유니코드 표현을 맞춤 (공백뿐이면 @IsNotEmpty에 걸림)
const normalizeName = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().normalize("NFC") : value;

// 제어 문자(NUL은 PostgreSQL이 거부해 500이 됨)를 막고, 폭 없는 문자만으로 된 이름처럼 눈에 안 보이는 이름도 막음
const VISIBLE_NAME = /^(?=.*[^\p{Z}\p{C}])\P{Cc}*$/su;

export class AdminInterestDto {
  pk: number;
  name: string;
  /** 작은 값이 먼저 나옴 */
  sort_order: number;
}

export class AdminInterestNameRequestDto {
  /** 앞뒤 공백을 지운 뒤 1~50자. 같은 이름은 등록할 수 없음 */
  @Transform(normalizeName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(VISIBLE_NAME)
  name: string;
}

export class ReorderAdminInterestRequestDto {
  /** 현재 목록의 pk 전체를 원하는 순서로 */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(INTEREST_PK_MAX, { each: true })
  pks: number[];
}
