import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "node:path";
import { SlackModule } from "nestjs-slack";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { LoggerModule } from "@src/global/logger/logger.module";
import { ConsentModule } from "@src/consent/consent.module";
import { FileModule } from "@src/file/file.module";
import { GraduatedModule } from "@src/graduated/graduated.module";
import { UserModule } from "@src/user/user.module";
import { StudentModule } from "@src/student/student.module";
import { CheersModule } from "@src/cheers/cheers.module";
import { HealthModule } from "@src/health/health.module";
import { ManagerModule } from "@src/manager/manager.module";
import { ManagerConsentModule } from "@src/manager/consent/manager-consent.module";

@Module({
  imports: [
    // 어드민 화면 (admin/ 빌드 결과). /admin 아래만 차지해 다른 경로에 영향이 없음
    ServeStaticModule.forRoot({
      // 빌드 결과물 기준 __dirname: dist/src -> ../../admin/dist
      rootPath: join(__dirname, "..", "..", "admin", "dist"),
      serveRoot: "/admin",
    }),
    ConfigModule,
    DatabaseModule,
    ScheduleModule.forRoot(),
    LoggerModule,
    SlackModule.forRootAsync({
      imports: [ConfigModule],
      isGlobal: true,
      useFactory: (configService: ConfigService) => ({
        type: "webhook",
        channels: [
          {
            name: "bug",
            url: configService.get<string>("SLACK_WEBHOOK_URL"),
          },
        ],
        defaultChannel: "bug",
      }),
      inject: [ConfigService],
    }),
    UserModule,
    ConsentModule,
    FileModule,
    StudentModule,
    GraduatedModule,
    CheersModule,
    HealthModule,
    ManagerModule,
    ManagerConsentModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
