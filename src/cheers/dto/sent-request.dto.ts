import { CoffeeChatRequestStatus } from "@src/cheers/cheers.utils";

export class RequestGraduatedDto {
  graduated_id: string;
  nickname: string;
  company: string;
  job: string;
}

export class SentRequestDto {
  id: string;
  graduated: RequestGraduatedDto;
  message: string;
  status: CoffeeChatRequestStatus;
  created_at: string;
}

// 공유 시점의 현업자 연락처
export class SharedContactDto {
  // 현업자가 탈퇴했거나 탈퇴 유예기간 중이면 "탈퇴한 계정"
  name: string;
  email: string | null;
  phone: string | null;
  shared_at: string;
}

export class SentRequestDetailDto extends SentRequestDto {
  // 공유 전이면 null
  shared_contact: SharedContactDto | null;
}
