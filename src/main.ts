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
import { Logger } from "@nestjs/common";

async function bootstrap() {
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

const bootstrapWithOTEL = async () => {
  const logger = new Logger("Bootstrap");
  try {
    const serviceName = process.env.OTEL_SERVICE_NAME ?? "cheers-be";
    initializeMetrics(serviceName);
    await bootstrap();
  } catch (error) {
    logger.error("Failed to bootstrap application", error);
    process.exit(1);
  }
};

void bootstrapWithOTEL();
