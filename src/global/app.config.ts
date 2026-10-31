import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SlackService } from "nestjs-slack";
import { createCorsOptions } from "@src/global/cors/cors.config";
import { AllExceptionsFilter } from "@src/global/filters/all-exception.filter";
import { HttpLoggingInterceptor } from "@src/global/interceptors/http-logging.interceptor";

// 요청 처리에 영향을 주는 전역 설정. e2e가 운영과 같은 설정을 검증하도록 main.ts와 같이 씀
export function configureApp(app: INestApplication): void {
  app.enableCors(createCorsOptions(app.get(ConfigService)));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: false, // 암시적 타입 변환 비활성화
      },
    }),
  );

  app.useGlobalInterceptors(new HttpLoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(app.get(SlackService)));
}
