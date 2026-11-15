import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SlackService } from "nestjs-slack";
import { AligoAlertStateRepository } from "./aligo-alert-state.repository";
import { AlimtalkService } from "./alimtalk.service";
import { ALIGO_LOW_BALANCE_ALERT_INTERVAL_MS } from "./notification.constants";
import { pickRemaining } from "./notification.utils";

export type AligoBalanceCheckResult =
  | "skipped"
  | "error"
  | "ok"
  | "alerted"
  | "already_alerted";

// 알리고 잔여량이 기준값 이하이면 Slack으로 알림 (AligoBalanceAlertScheduler가 매시 호출, CRB-78).
// 부족한 동안에는 24시간에 한 번만 알리고, 기준값을 넘으면 상태를 초기화함
@Injectable()
export class AligoBalanceAlertService {
  private readonly logger = new Logger(AligoBalanceAlertService.name);

  constructor(
    private readonly alimtalkService: AlimtalkService,
    private readonly stateRepository: AligoAlertStateRepository,
    private readonly configService: ConfigService,
    private readonly slackService: SlackService,
  ) {}

  /** 어드민 화면에 보여주는 기준값. 설정되지 않았거나 숫자가 아니면 null (알림 꺼짐) */
  getThreshold(): number | null {
    const raw = this.configService.get<string>("ALIGO_LOW_BALANCE_THRESHOLD");
    if (raw === undefined || raw.trim() === "") return null;
    const threshold = Number(raw);
    return Number.isFinite(threshold) && threshold >= 0 ? threshold : null;
  }

  async check(now: Date = new Date()): Promise<AligoBalanceCheckResult> {
    const threshold = this.getThreshold();
    if (threshold === null) return "skipped";

    const balance = await this.alimtalkService.fetchBalance();
    if (balance.status === "not_configured") return "skipped";
    if (balance.status === "error") {
      // 조회 실패를 부족으로 보지 않음. 다음 실행에서 다시 확인
      this.logger.warn(`Aligo balance check failed: ${balance.error}`);
      return "error";
    }

    const remaining = pickRemaining(balance);
    if (remaining === null) {
      this.logger.warn(
        "Aligo balance response has no value to compare with the threshold.",
      );
      return "error";
    }

    if (remaining.value > threshold) {
      await this.stateRepository.clear();
      return "ok";
    }

    const claimed = await this.stateRepository.claimAlert(
      now,
      new Date(now.getTime() - ALIGO_LOW_BALANCE_ALERT_INTERVAL_MS),
    );
    if (!claimed) return "already_alerted";

    const message =
      `Aligo balance is low: ${remaining.label} ${remaining.value} (threshold ${threshold}), ` +
      `amount ${balance.amount ?? "unknown"}, counts ${JSON.stringify(balance.counts)}`;
    this.logger.error(message);
    this.slackService
      .sendText(`*[ALIGO LOW BALANCE]*\n${message}`, { channel: "bug" })
      .catch((err) => {
        this.logger.error("Failed to send Slack notification", err);
      });
    return "alerted";
  }
}
