import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { SlackModule } from "nestjs-slack";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { LoggerModule } from "@src/global/logger/logger.module";
import { ConsentModule } from "@src/consent/consent.module";
import { FileModule } from "@src/file/file.module";
import { AppController } from "./app.controller";
import { UserModule } from "@src/user/user.module";
import { StudentModule } from "@src/student/student.module";

@Module({
  imports: [
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
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
