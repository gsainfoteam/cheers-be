import { ApiProperty } from "@nestjs/swagger";
import { NextStep, UserStatus, UserType } from "@src/auth/auth.types";

export class ContactDto {
  email_enabled: boolean;
  kakao_enabled: boolean;
  email: string | null;
  phone: string | null;
}

export class DepartmentDto {
  id: number;
  name: string;
}

export class AttachmentDto {
  kind: "cv" | "portfolio";
  source: "link" | "file";
  /** source = file 이면 presigned URL */
  url: string;
  file_name: string | null;
}

// 재학생 본인 조회용. key는 수정 때 기존 파일을 유지하려고 다시 보내는 값 (현업자에게는 내리지 않음)
export class StudentAttachmentDto extends AttachmentDto {
  /** source = file 일 때만. 수정 때 기존 파일을 유지하려면 그대로 다시 보냄 */
  key: string | null;
}

export class StudentProfileDto {
  department: DepartmentDto;
  interests: string[];
  activities: string[];
  attachments: StudentAttachmentDto[];
  contact: ContactDto | null;
}

export class StudentInfoDto {
  email: string | null;
  verified: boolean;
  profile: StudentProfileDto | null;
}

export class GraduatedProfileDto {
  nickname: string;
  company: string;
  department: string;
  job: string;
  hashtags: string[];
  links: string[];
  contact: ContactDto | null;
}

export class GraduatedInfoDto {
  verified: boolean;
  profile: GraduatedProfileDto | null;
}

export class UserInfoDto {
  id: string;
  type: UserType;
  status: UserStatus;
  /** 가입 중일 때 다음 단계. 가입을 마쳤으면 null */
  // 플러그인이 타입 별칭의 null을 빠뜨려 직접 지정
  @ApiProperty({
    type: String,
    enum: ["consent", "verify", "profile"],
    nullable: true,
  })
  next_step: NextStep;
  name: string | null;
  email: string | null;
  consent_required: boolean;
  student: StudentInfoDto | null;
  graduated: GraduatedInfoDto | null;
}
