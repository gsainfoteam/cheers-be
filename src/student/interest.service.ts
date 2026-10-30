import type { OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { InterestRepository } from "@src/database/repository/interest.repository";

// 재학생 입력 화면에 보여줄 관심 분야 목록의 출처는 DB 하나. 기동 때 읽어 메모리에 두고, app.listen은 이 작업이 끝난 뒤에 요청을 받음
@Injectable()
export class InterestService implements OnModuleInit {
  private readonly logger = new Logger(InterestService.name);
  private names: readonly string[] = [];

  constructor(private readonly interestRepository: InterestRepository) {}

  async onModuleInit() {
    // 조회 오류는 잡지 않고 기동을 실패시킴 (DB를 못 읽는 상태로 뜨지 않게)
    const names = await this.interestRepository.findAllNames();
    if (names.length === 0) {
      this.logger.warn("No interests found. The interest list will be empty.");
    }
    this.names = names;
  }

  getNames(): string[] {
    return [...this.names];
  }
}
