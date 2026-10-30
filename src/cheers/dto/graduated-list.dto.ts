import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { GRADUATED_CARD_SORTS } from "@src/cheers/cheers.constants";
import { GraduatedCardSort } from "@src/database/repository/graduated-card.repository";
import { PaginationQueryDto } from "./pagination.dto";

export class GraduatedListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GRADUATED_CARD_SORTS })
  @IsOptional()
  @IsIn(GRADUATED_CARD_SORTS)
  sort: GraduatedCardSort = "recent_joined";
}

// 이름 · 부서 · 연락처는 비공개라 포함하지 않음
export class CheersCardDto {
  graduated_id: string;
  nickname: string;
  company: string;
  job: string;
  hashtags: string[];
  links: string[];
  last_active_at: string;
  /** 연락 설정이 "희망하지 않음"이면 false */
  can_request: boolean;
}
