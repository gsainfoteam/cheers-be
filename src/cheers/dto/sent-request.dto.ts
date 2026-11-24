import { CoffeeChatRequestStatus } from "@src/cheers/cheers.utils";

export class RequestGraduatedDto {
  graduated_id: string;
  nickname: string;
  company: string;
  /** 선택 입력이라 없으면 null. 선배가 탈퇴했거나 유예기간 중이면 null */
  department: string | null;
  job: string;
  /** 선배가 탈퇴했거나 유예기간 중이면 [] */
  hashtags: string[];
}

export class RequestGraduatedDetailDto extends RequestGraduatedDto {
  /** 회사 로고 presigned GET URL. 로고가 없거나 선배가 탈퇴했으면 null */
  company_logo_url: string | null;
  /** links[0]이 LinkedIn. 선배가 탈퇴했거나 유예기간 중이면 [] */
  links: string[];
}

// graduated의 타입이 목록 · 상세에서 달라 여기에는 두지 않음.
// 상속한 필드의 타입을 다시 선언하면(declare 포함) Swagger가 부모 타입으로 보여 줌 (CRB-105, AGENTS.md)
export class SentRequestBaseDto {
  id: string;
  /** 현업자가 탈퇴했거나 탈퇴 유예기간 중이면 true (프론트는 탈퇴 안내를 보여 줌) */
  graduated_withdrawn: boolean;
  message: string;
  status: CoffeeChatRequestStatus;
  created_at: string;
}

export class SentRequestDto extends SentRequestBaseDto {
  graduated: RequestGraduatedDto;
}

// 공유 시점의 현업자 연락처
export class SharedContactDto {
  /** 현업자가 탈퇴했거나 탈퇴 유예기간 중이면 "탈퇴한 계정", email · phone은 null */
  name: string;
  email: string | null;
  phone: string | null;
  shared_at: string;
}

export class SentRequestDetailDto extends SentRequestBaseDto {
  graduated: RequestGraduatedDetailDto;
  /** 공유 전이면 null */
  shared_contact: SharedContactDto | null;
}
