import { UserStatus, UserType } from "@src/auth/auth.types";

// 가드가 검증한 access token의 유저. request.user에 담김
export class UserContext {
  constructor(
    readonly userPk: string,
    readonly type: UserType,
    readonly status: UserStatus,
  ) {}
}
