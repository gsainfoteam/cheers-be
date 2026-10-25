import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { SlackModule } from "nestjs-slack";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { LoggerModule } from "@src/global/logger/logger.module";
import { AppController } from "./app.controller";
import { UserModule } from "@src/user/user.module";

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
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
