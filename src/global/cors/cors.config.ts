import { Logger } from "@nestjs/common";
import { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";
import { ConfigService } from "@nestjs/config";

const logger = new Logger("Cors");

const ALLOWED_PROTOCOLS = ["http:", "https:"];

function parseOrigin(value: string): string {
  const invalid = new Error(
    `Invalid CORS_ALLOWED_ORIGINS entry: "${value}". Expected an origin like https://example.com.`,
  );

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid;
  }

  const isOriginOnly =
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password;
  if (
    !ALLOWED_PROTOCOLS.includes(url.protocol) ||
    !isOriginOnly ||
    // https://*.example.com 은 URL로는 파싱되지만 어떤 Origin과도 일치하지 않음
    value.includes("*")
  ) {
    throw invalid;
  }

  // 브라우저가 보내는 Origin과 같은 형태로 맞춤 (끝의 /, 대문자, 기본 포트)
  return url.origin;
}

export function parseCorsOrigins(raw: string | undefined): string[] {
  const values = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values.map(parseOrigin))];
}

export function createCorsOptions(configService: ConfigService): CorsOptions {
  const origins = parseCorsOrigins(
    configService.get<string>("CORS_ALLOWED_ORIGINS"),
  );
  if (origins.length === 0) {
    // 배포 환경에서는 브라우저 호출이 전부 막힌 채로 뜨지 않게 막음
    if (configService.get<string>("NODE_ENV") === "production") {
      throw new Error("CORS_ALLOWED_ORIGINS is required in production.");
    }
    logger.warn(
      "CORS_ALLOWED_ORIGINS is not set. All cross-origin browser requests will be rejected.",
    );
  }

  return {
    origin: origins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    // 토큰을 쿠키가 아니라 Authorization 헤더와 본문으로 주고받음
    credentials: false,
    maxAge: 600,
  };
}
