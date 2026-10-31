import { INestApplication, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CronJob } from "cron";
import { sql } from "drizzle-orm";
import { SlackService } from "nestjs-slack";
import { AppModule } from "@src/app.module";
import { DatabaseService } from "@src/database/database.service";
import { configureApp } from "@src/global/app.config";
import { MailService } from "@src/mail/mail.service";
import { MailResult, SendMailInput } from "@src/mail/mail.types";
import { GoogleVerifier } from "@src/user/oauth/google.verifier";
import { OAuthProfile, OAuthVerifier } from "@src/user/oauth/oauth.types";
import { FakeS3 } from "./fake-s3";

// skipped는 env가 비었을 때의 실제 동작과 같음
const MAIL_SKIPPED: MailResult = { success: true, skipped: true };

// token 문자열 → 계정. 실제 서명 검증은 src/user/oauth/id-token.verifier.spec.ts에서 확인
class FakeGoogleVerifier implements OAuthVerifier {
  async verify(token: string, nonce?: string): Promise<OAuthProfile> {
    const [prefix, sub, email] = token.split(":");
    if (prefix !== "fake-google" || !sub || !nonce) {
      throw new UnauthorizedException("Invalid OAuth token");
    }
    return { provider: "google", sub, email: email ?? null };
  }
}

// 인증번호는 메일로만 나가므로 받은 메일을 모아서 꺼내 씀
export class FakeMailService {
  readonly sent: SendMailInput[] = [];
  // notification_log 기록을 확인할 때만 바꿈 (skipped면 기록하지 않음). reset에서 되돌림
  sendResult: MailResult = MAIL_SKIPPED;

  async send(input: SendMailInput): Promise<MailResult> {
    this.sent.push(input);
    return this.sendResult;
  }

  sendAsync(input: SendMailInput): void {
    this.sent.push(input);
  }

  latestVerificationCode(to: string): string {
    const mail = this.sent.filter((m) => m.to === to).at(-1);
    const code = mail?.text?.match(/\b\d{6}\b/)?.[0];
    if (!code) throw new Error(`No verification code mail to ${to}`);
    return code;
  }
}

export class FakeSlackService {
  readonly messages: string[] = [];

  async sendText(message: string): Promise<void> {
    this.messages.push(message);
  }
}

export type E2eContext = {
  app: INestApplication;
  db: DatabaseService["db"];
  s3: FakeS3;
  mail: FakeMailService;
  slack: FakeSlackService;
  // 테스트 사이 데이터 초기화
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

// main.ts와 같은 전역 설정(configureApp)으로 AppModule을 띄움. listen 없이 supertest가 직접 호출
export async function createE2eApp(): Promise<E2eContext> {
  const s3 = new FakeS3();
  const mail = new FakeMailService();
  const slack = new FakeSlackService();
  s3.install();

  // 메일 · 슬랙 · S3는 가짜이고, 남은 외부 호출(Aligo)은 키가 없어 fetch까지 가지 않음.
  // 호출하는 쪽이 예외를 삼킬 수 있으므로(AlimtalkService) close에서 호출 여부를 확인해 실패시킴
  const fetchSpy = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((input) => {
      throw new Error(`Unexpected external request in e2e: ${String(input)}`);
    });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleVerifier)
    .useValue(new FakeGoogleVerifier())
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(SlackService)
    .useValue(slack)
    .compile();

  // 4xx도 에러 로그로 남아 출력이 넘치므로 기본은 끔. 디버깅할 때 E2E_LOG=true
  const app = moduleRef.createNestApplication({
    logger: process.env.E2E_LOG === "true" ? ["error", "warn"] : false,
  });
  configureApp(app);

  // cron이 돌아 결과가 흔들리지 않게 등록만 하고 시작하지 않음. 스케줄러 작업은 서비스 메서드를 직접 호출
  const cronStartSpy = jest
    .spyOn(CronJob.prototype, "start")
    .mockImplementation(() => undefined);
  await app.init();
  cronStartSpy.mockRestore();

  const db = app.get(DatabaseService).db;

  return {
    app,
    db,
    s3,
    mail,
    slack,
    reset: async () => {
      // 테스트 DB 전용 (test/setup-env.ts에서 로컬 *_e2e DB만 허용). users를 참조하는 테이블이 모두 비워지고,
      // 참조하지 않는 기준 데이터(consent, school, department, interest)와 서명 키는 남음
      await db.execute(sql`TRUNCATE "users" CASCADE`);
      s3.reset();
      mail.sent.length = 0;
      mail.sendResult = MAIL_SKIPPED;
      slack.messages.length = 0;
    },
    close: async () => {
      await app.close();
      s3.uninstall();
      const requests = fetchSpy.mock.calls.map(([input]) => String(input));
      fetchSpy.mockRestore();
      if (requests.length > 0) {
        throw new Error(`Unexpected external requests: ${requests.join(", ")}`);
      }
    },
  };
}
