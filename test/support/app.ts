import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { SlackService } from "nestjs-slack";
import { AppModule } from "@src/app.module";
import { DatabaseService } from "@src/database/database.service";
import { createCorsOptions } from "@src/global/cors/cors.config";
import { AllExceptionsFilter } from "@src/global/filters/all-exception.filter";
import { HttpLoggingInterceptor } from "@src/global/interceptors/http-logging.interceptor";
import { MailService } from "@src/mail/mail.service";
import { SendMailInput } from "@src/mail/mail.types";
import { GoogleVerifier } from "@src/user/oauth/google.verifier";
import { OAuthProfile, OAuthVerifier } from "@src/user/oauth/oauth.types";
import { FakeS3 } from "./fake-s3";

// 기준 데이터(consent, school, department, interest)와 서명 키는 마이그레이션 · 기동 때 들어가므로 남김
const USER_DATA_TABLES = [
  "notification_log",
  "coffee_chat_request",
  "coffee_chat_contact",
  "student_profile_attachment",
  "student_profile",
  "student_email_verification",
  "student_email_send_log",
  "student",
  "graduated_profile",
  "graduated",
  "user_consent",
  "refresh_token",
  "user_oauth_account",
  "users",
];

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

// 인증번호는 메일로만 나가므로 받은 메일을 모아서 꺼내 씀. skipped는 env가 비었을 때의 실제 동작과 같음
export class FakeMailService {
  readonly sent: SendMailInput[] = [];

  async send(input: SendMailInput) {
    this.sent.push(input);
    return { success: true, skipped: true };
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

// main.ts의 bootstrap과 같은 전역 설정으로 AppModule을 띄움. listen 없이 supertest가 직접 호출
export async function createE2eApp(): Promise<E2eContext> {
  const s3 = new FakeS3();
  const mail = new FakeMailService();
  const slack = new FakeSlackService();
  s3.install();

  // 메일 · 슬랙 · S3는 가짜이고, 남은 외부 호출(Solapi)은 키가 없어 fetch까지 가지 않음. 새 경로가 생기면 여기서 실패
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
  app.enableCors(createCorsOptions(app.get(ConfigService)));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalInterceptors(new HttpLoggingInterceptor());
  app.useGlobalFilters(
    new AllExceptionsFilter(slack as unknown as SlackService),
  );
  await app.init();

  // 테스트 중에 cron이 돌아 결과가 흔들리지 않게 멈춤. 스케줄러 작업은 서비스 메서드를 직접 호출
  for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
    void job.stop();
  }

  const db = app.get(DatabaseService).db;

  return {
    app,
    db,
    s3,
    mail,
    slack,
    reset: async () => {
      const tables = USER_DATA_TABLES.map((t) => `"${t}"`).join(", ");
      // 테스트 DB 전용 (test/setup-env.ts에서 로컬 *_e2e DB만 허용)
      await db.execute(sql.raw(`TRUNCATE ${tables} CASCADE`));
      s3.reset();
      mail.sent.length = 0;
      slack.messages.length = 0;
    },
    close: async () => {
      await app.close();
      s3.uninstall();
      fetchSpy.mockRestore();
    },
  };
}
