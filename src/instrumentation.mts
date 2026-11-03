import { initializeOpenTelemetry } from "@gsainfoteam/nest-observability";

export const serviceName = process.env.OTEL_SERVICE_NAME || "cheers-be";

// 자동 계측은 express · pg가 로드되기 전에 걸려야 하므로 main.ts에서 가장 먼저 import함.
// ConfigModule이 뜨기 전이라 .env가 아니라 프로세스 환경 변수(K8s)만 읽음.
// 주소가 없으면(로컬 · 테스트) 켜지 않아 metrics 포트도 열리지 않음
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

if (otlpEndpoint) {
  // 모니터링 때문에 서비스가 죽지 않도록 실패해도 기동은 계속함
  initializeOpenTelemetry({
    serviceName,
    otlpEndpoint,
    metricsPort: Number(process.env.METRICS_PORT || 9090),
    ignorePatterns: ["/health", "/health/ready", "/metrics"],
  }).catch((error) => {
    console.error("Failed to initialize OpenTelemetry", error);
  });
}
