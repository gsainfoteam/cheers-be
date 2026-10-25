import { Injectable } from "@nestjs/common";
import { UserRepository } from "@src/database/repository/user.repository";
import { TxType } from "@src/global/types/tx.types";
import { NextStep, TokenSubject } from "@src/auth/auth.types";
import { calculateNextStep } from "@src/auth/signup-step";

@Injectable()
export class SignupStepService {
  constructor(private readonly userRepository: UserRepository) {}

  // 내 정보 API, 가입 단계 가드, 토큰 재발급에서 같이 사용
  async getNextStep(user: TokenSubject, tx?: TxType): Promise<NextStep> {
    if (user.status === "active") return null;

    const progress = await this.userRepository.findSignupProgress(
      user.pk,
      user.type,
      tx,
    );
    return calculateNextStep(user.status, progress);
  }
}
