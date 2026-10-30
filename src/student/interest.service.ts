import type { OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { InterestRepository } from "@src/database/repository/interest.repository";

// 고정 관심 분야 목록의 출처는 DB 하나. 기동 때 읽어 메모리에 두고, app.listen은 이 작업이 끝난 뒤에 요청을 받음
@Injectable()
export class InterestService implements OnModuleInit {
  private readonly logger = new Logger(InterestService.name);
  private names: readonly string[] = [];
  private nameSet: ReadonlySet<string> = new Set();

  constructor(private readonly interestRepository: InterestRepository) {}

  async onModuleInit() {
    // 조회 오류는 잡지 않음. 목록 없이 뜨면 재학생 정보 저장이 모두 막히므로 기동을 실패시킴
    const names = await this.interestRepository.findAllNames();
    if (names.length === 0) {
      this.logger.warn("No interests found. Student info cannot be saved.");
    }
    this.names = names;
    this.nameSet = new Set(names);
  }

  getNames(): string[] {
    return [...this.names];
  }

  // 목록에 없는 값 (보낸 순서 유지)
  findUnknown(values: string[]): string[] {
    return values.filter((v) => !this.nameSet.has(v));
  }
}
