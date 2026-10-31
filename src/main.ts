import { serviceName } from "./instrumentation";
import {
  initializeMetrics,
  MetricsInterceptor,
} from "@gsainfoteam/nest-observability";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ConfigService } from "@nestjs/config";
import { configureApp } from "@src/global/app.config";
import { LoggerService } from "@src/global/logger/logger.service";
import { setupSwagger } from "@src/global/swagger/swagger.config";

async function bootstrap() {
  initializeMetrics(serviceName);

  const app = await NestFactory.create(AppModule);

  const loggerService: LoggerService = app.get(LoggerService);
  app.useLogger(loggerService);

  const configService: ConfigService = app.get(ConfigService);

  app.useGlobalInterceptors(new MetricsInterceptor());
  configureApp(app);

  setupSwagger(app, configService);

  app.enableShutdownHooks();

  await app.listen(configService.get<number>("PORT") ?? 3000);
}
bootstrap();
