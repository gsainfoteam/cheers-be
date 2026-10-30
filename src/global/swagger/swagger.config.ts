import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export const SWAGGER_PATH = "api-docs";

// 빈 값은 미설정으로 봄. 오타로 조용히 켜지거나 꺼지지 않도록 그 외 값은 서버가 뜨지 않게 막음
export function isSwaggerEnabled(configService: ConfigService): boolean {
  const raw = configService.get<string>("SWAGGER_ENABLED")?.trim();
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  throw new Error(`SWAGGER_ENABLED must be true or false (got "${raw}").`);
}

// 이미지에 NODE_ENV=production이 고정돼 있어 staging과 production을 env 값으로 구분.
// 꺼져 있으면 경로를 등록하지 않아 UI와 JSON 모두 404
export function setupSwagger(
  app: INestApplication,
  configService: ConfigService,
): void {
  if (!isSwaggerEnabled(configService)) return;

  const config = new DocumentBuilder()
    .setTitle("Cheers API")
    .setVersion("v1")
    .addBearerAuth()
    .build();

  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    SwaggerModule.createDocument(app, config),
    {
      raw: ["json"],
      swaggerOptions: { persistAuthorization: true },
    },
  );
}
