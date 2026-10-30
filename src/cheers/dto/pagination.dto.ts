import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@src/cheers/cheers.constants";

// query string은 문자열로 들어오고 암시적 변환을 꺼 두었으므로 @Type으로 숫자 변환
export class PaginationQueryDto {
  /** 1부터 시작 */
  // 기본값이 있어 플러그인이 required로 읽으므로 선택임을 직접 지정
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  size: number = DEFAULT_PAGE_SIZE;
}

export class PageResponseDto<T> {
  // 플러그인이 제네릭 타입을 읽지 못함. 항목 형식은 API마다 ApiPageResponse로 지정
  @ApiProperty({ type: "array", items: { type: "object" } })
  items: T[];
  page: number;
  size: number;
  total: number;
}
