import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@src/cheers/cheers.constants";

// query string은 문자열로 들어오고 암시적 변환을 꺼 두었으므로 @Type으로 숫자 변환
export class PaginationQueryDto {
  // 1부터 시작
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  size: number = DEFAULT_PAGE_SIZE;
}

export class PageResponseDto<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}
