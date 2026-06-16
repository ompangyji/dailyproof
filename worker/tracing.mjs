/**
 * worker용 OpenTelemetry 초기화.
 *
 * web(@vercel/otel)과 동일하게 span을 OTLP/HTTP로 trace 백엔드(로컬 Jaeger all-in-one,
 * 4318)로 export한다. service.name 은 web과 구분되게 dailyproof-worker.
 * NodeSDK가 기본으로 W3C traceContext propagator를 전역 등록하므로, worker에서
 * propagation.extract(traceparent) 로 web이 심어둔 부모 컨텍스트를 복원할 수 있다.
 *
 * worker.mjs 맨 위에서 import 되어 다른 작업보다 먼저 sdk.start() 가 실행된다.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

const sdk = new NodeSDK({
  serviceName: "dailyproof-worker",
  traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
});

sdk.start();

/** 종료 시 호출 — 버퍼에 남은 span을 flush하고 SDK를 정리한다. */
export async function shutdownTracing() {
  try {
    await sdk.shutdown();
  } catch {
    // 종료 중 export 실패는 무시(어차피 프로세스가 내려간다).
  }
}
