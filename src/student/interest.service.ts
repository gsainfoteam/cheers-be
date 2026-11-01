import type { OnModuleInit } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InterestRepository } from "@src/database/repository/interest.repository";

// 재학생 입력 화면에 보여줄 관심 분야 목록의 출처는 DB 하나. 기동 때 읽어 메모리에 두고, app.listen은 이 작업이 끝난 뒤에 요청을 받음.
// 어드민이 목록을 바꾸면 그 요청을 처리한 인스턴스는 바로, 다른 인스턴스는 다음 주기 재조회 때 반영 (최대 1분 차이)
@Injectable()
export class InterestService implements OnModuleInit {
  private readonly logger = new Logger(InterestService.name);
  private names: readonly string[] = [];
  private lastStartedRefresh = 0;
  private lastAppliedRefresh = 0;

  constructor(private readonly interestRepository: InterestRepository) {}

  async onModuleInit() {
    // 조회 오류는 잡지 않고 기동을 실패시킴 (DB를 못 읽는 상태로 뜨지 않게)
    const names = await this.interestRepository.findAllNames();
    if (names.length === 0) {
      this.logger.warn("No interests found. The interest list will be empty.");
    }
    this.names = names;
  }

  // 실패해도 예외를 던지지 않음: 기존 목록을 유지하고 다음 주기에 다시 시도
  @Cron(CronExpression.EVERY_MINUTE, { name: "interest-cache-refresh" })
  async refresh(): Promise<void> {
    const refresh = ++this.lastStartedRefresh;
    try {
      const names = await this.interestRepository.findAllNames();
      // 먼저 시작한 조회가 늦게 끝나도 더 최근 결과를 옛 목록으로 덮어쓰지 않음
      if (refresh > this.lastAppliedRefresh) {
        this.lastAppliedRefresh = refresh;
        this.names = names;
      }
    } catch (e) {
      this.logger.error(
        `Interest cache refresh failed: ${(e as Error).message}`,
        (e as Error).stack,
      );
    }
  }

  getNames(): string[] {
    return [...this.names];
  }
}
