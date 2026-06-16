import { registerOTel, OTLPHttpProtoTraceExporter } from "@vercel/otel";

// Next.js 서버 시작 시 1회 실행되는 훅. nodejs 런타임에서 SIGTERM을 잡아
// readiness를 떨궈(/health/ready → 503) 오케스트레이터가 트래픽을 빼게 한다.
// SIGTERM = 오케스트레이터(k3s)의 정상 종료 신호 → 여기에 graceful shutdown을 건다.
// SIGINT(터미널에서 프로세스를 직접 중단하는 인터럽트 신호, 예: Ctrl+C)는 미처리한다 —
// 가로채면 Node의 기본 종료가 막혀 로컬 dev를 멈추기 어려워지기 때문.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // OpenTelemetry: 웹 요청마다 root span 생성 + HTTP/fetch auto-instrumentation.
  // span은 OTLP/HTTP로 trace 백엔드(로컬 Jaeger all-in-one, 4318)로 export한다.
  // 운영 백엔드는 Grafana 스택과 일관되게 Tempo로 교체 예정 — exporter가 OTLP라 endpoint만 바뀜.
  const otlp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "dailyproof-web",
    attributes: { "deployment.environment": process.env.APP_ENV ?? "dev" },
    traceExporter: new OTLPHttpProtoTraceExporter({ url: `${otlp}/v1/traces` }),
  });

  const { beginShutdown } = await import("@/lib/lifecycle");
  const { log } = await import("@/lib/log");

  process.once("SIGTERM", () => {
    log.warn("SIGTERM 수신 — readiness 차단(graceful shutdown)", { signal: "SIGTERM" });
    beginShutdown();
    // 트래픽 중단·in-flight drain·종료는 readiness 503을 본 오케스트레이터(grace period)가 처리.
  });
}
