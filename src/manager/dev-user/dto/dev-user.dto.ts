import { ApiProperty } from "@nestjs/swagger";

export const DEV_USER_STATUSES = [
  "pending",
  "active",
  "withdrawal_requested",
  "withdrawn",
] as const;

export type DevUserStatus = (typeof DEV_USER_STATUSES)[number];

// 완전탈퇴할 계정을 고르는 데 필요한 값만 내려줌. 연락처는 넣지 않음
export class DevUserDto {
  user_pk: string;

  @ApiProperty({ enum: ["student", "graduated"] })
  type: "student" | "graduated";

  /** withdrawal_requested: 탈퇴 유예기간 중, withdrawn: 탈퇴 처리 완료 (이름 · 이메일이 지워져 있음) */
  @ApiProperty({ enum: DEV_USER_STATUSES })
  status: DevUserStatus;

  /** OAuth 계정 이름. 탈퇴 처리가 끝났으면 null */
  name: string | null;

  /** OAuth 계정 이메일. 탈퇴 처리가 끝났으면 null */
  email: string | null;

  created_at: Date;
}
