import { UserRow } from "@src/database/repository/user.repository";

export type UserType = UserRow["type"];
export type UserStatus = UserRow["status"];

// 가입 중일 때 다음 단계. 가입을 마쳤으면 null
export type NextStep = "consent" | "verify" | "profile" | null;
export type SignupStepName = Exclude<NextStep, null>;

// 토큰에는 가입 단계를 넣지 않고 pending 여부만 둠. 단계는 DB 기준으로 판단
export type AccessTokenPayload = {
  sub: string;
  type: UserType;
  status: UserStatus;
};

export type TokenSubject = {
  pk: string;
  type: UserType;
  status: UserStatus;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
};
