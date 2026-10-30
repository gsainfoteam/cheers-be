import { CoffeeChatRequestStatus } from "@src/cheers/cheers.utils";
import { AttachmentDto } from "@src/user/dto/user-info.dto";

export class ReceivedRequestDto {
  id: string;
  // 재학생이 탈퇴했거나 탈퇴 유예기간 중이면 "탈퇴한 학생의 신청서입니다"
  student_name: string;
  // 요청 당시 학과
  department: string;
  // true면 상세를 열람할 수 없음 (프론트는 목록 클릭을 막음)
  student_withdrawn: boolean;
  status: CoffeeChatRequestStatus;
  created_at: string;
}

export class RequestStudentDto {
  name: string;
  department: string;
  interests: string[];
  activities: string[];
  attachments: AttachmentDto[];
  // 재학생의 현재 연락 설정에서 고른 값. 고르지 않았으면 null
  email: string | null;
  phone: string | null;
}

export class ReceivedRequestDetailDto {
  id: string;
  message: string;
  status: CoffeeChatRequestStatus;
  created_at: string;
  contact_shared_at: string | null;
  student: RequestStudentDto;
}

export class ShareContactResponseDto {
  contact_shared_at: string;
  shared_email: string | null;
  shared_phone: string | null;
}
