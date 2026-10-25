import { Reflector } from "@nestjs/core";
import { SignupStepName } from "@src/auth/auth.types";

export type SignupStepOptions = {
  step: SignupStepName;
  // 가입을 마친 뒤에도 수정용으로 호출 가능 (약관 동의, 추가 정보 입력)
  allowActive?: boolean;
};

// SignupStepGuard와 같이 사용
export const SignupStep = Reflector.createDecorator<SignupStepOptions>();
