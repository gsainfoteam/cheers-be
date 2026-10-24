import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllExceptionsFilter } from "./global/filters/all-exception.filter";
import { LoggerService } from "@src/global/logger/logger.service";
import { HttpLoggingInterceptor } from "@src/global/interceptors/http-logging.interceptor";
import { SlackService } from "nestjs-slack";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const loggerService: LoggerService = app.get(LoggerService);
  app.useLogger(loggerService);

  const slackService: SlackService = app.get(SlackService);
  const configService: ConfigService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: false, // 암시적 타입 변환 비활성화
      },
    }),
  );

  app.useGlobalInterceptors(new HttpLoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(slackService));

  app.enableShutdownHooks();

  await app.listen(configService.get<number>("PORT") ?? 3000);
}
bootstrap();
