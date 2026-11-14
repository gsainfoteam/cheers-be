import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ALIMTALK_TEMPLATE_CACHE_TTL_MS } from "./notification.constants";
import {
  AlimtalkTemplateRepository,
  AlimtalkTemplateRow,
} from "./alimtalk-template.repository";
import { NotificationEvent } from "./notification.types";

// 예전에 템플릿 코드를 받던 환경변수. 서버가 뜰 때 DB의 코드가 비어 있으면 한 번 옮겨 담음 (CRB-78)
const LEGACY_TPL_CODE_ENVS: Record<NotificationEvent, string> = {
  coffee_chat_requested: "KAKAO_TEMPLATE_COFFEE_CHAT_REQUESTED",
  contact_shared: "KAKAO_TEMPLATE_CONTACT_SHARED",
};

// alimtalk_template을 메모리에 둠. TTL이 지나면 다음 조회가 다시 읽고, 어드민 수정 직후에는 그 인스턴스가 refresh()로 바로 읽음.
// 다른 인스턴스는 최대 TTL 뒤에 반영됨
@Injectable()
export class AlimtalkTemplateCache implements OnApplicationBootstrap {
  private readonly logger = new Logger(AlimtalkTemplateCache.name);
  private templates: ReadonlyMap<
    NotificationEvent,
    AlimtalkTemplateRow
  > | null = null;
  private loadedAt = 0;
  // 만료를 동시에 본 호출들이 DB를 한 번만 읽도록 진행 중인 로드를 공유
  private loading: Promise<void> | null = null;

  constructor(
    private readonly repository: AlimtalkTemplateRepository,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.migrateLegacyTplCodes();
  }

  /**
   * 이벤트의 템플릿을 돌려줍니다. 행이 없거나 처음 읽는 조회가 실패하면 null.
   * 다시 읽다 실패하면 이전 값을 그대로 씁니다 (경고 로그).
   */
  async get(
    event: NotificationEvent,
    now: number = Date.now(),
  ): Promise<AlimtalkTemplateRow | null> {
    if (
      this.templates === null ||
      now - this.loadedAt >= ALIMTALK_TEMPLATE_CACHE_TTL_MS
    ) {
      await this.load(now);
    }
    return this.templates?.get(event) ?? null;
  }

  /** 지금 다시 읽습니다. 실패해도 throw하지 않고 이전 값을 유지합니다. */
  async refresh(now: number = Date.now()): Promise<void> {
    await this.load(now, true);
  }

  private load(now: number, force = false): Promise<void> {
    if (this.loading && !force) return this.loading;
    const loading = this.doLoad(now).finally(() => {
      if (this.loading === loading) this.loading = null;
    });
    this.loading = loading;
    return loading;
  }

  private async doLoad(now: number): Promise<void> {
    try {
      const rows = await this.repository.findAll();
      this.templates = new Map(rows.map((row) => [row.event, row]));
      this.loadedAt = now;
    } catch (e) {
      // 이전 값이 있으면 계속 쓰고, 다음 조회에서 다시 시도
      this.logger.warn(
        `Alimtalk template cache load failed: ${(e as Error).message}`,
      );
    }
  }

  private async migrateLegacyTplCodes(): Promise<void> {
    for (const [event, envName] of Object.entries(LEGACY_TPL_CODE_ENVS) as [
      NotificationEvent,
      string,
    ][]) {
      const tplCode = this.configService.get<string>(envName)?.trim();
      if (!tplCode) continue;
      try {
        if (await this.repository.fillEmptyTplCode(event, tplCode)) {
          this.logger.log(
            `Moved ${envName} into alimtalk_template.tpl_code (${event}). The environment variable is no longer needed.`,
          );
        }
      } catch (e) {
        this.logger.error(
          `Failed to move ${envName} into alimtalk_template: ${(e as Error).message}`,
        );
      }
    }
  }
}
