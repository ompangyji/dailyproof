// 보안 이벤트 계측 — 거부(deny) 지점에서 호출해 ① 구조화 로그(security_event 필드)와
// ② in-process Prometheus 카운터를 동시에 남긴다.
//
// 한계(의도적으로 단순): 카운터는 in-process라 다중 pod에선 pod별로 분리되고 재시작 시 0이 된다.
// 그래서 '절대 누적'이 아니라 Prometheus가 pod별 카운터를 scrape해 rate()로 합산·평가하는 전제다
// (이게 카운터의 표준 사용법). edge 런타임(미들웨어)에서는 이 모듈을 공유할 수 없어, 미들웨어의
// 인증 리다이렉트는 로그로만 잡는다. 설계: docs/architecture/metrics.md (보안 이벤트 섹션)
import { log } from "@/lib/log";

export type SecurityEventType =
  | "rate_limited" // 429 — rate limit 초과
  | "forbidden" // 403 — 권한/소유 위반(예: source_path 비소유)
  | "unauthorized"; // 401 — 인증 없음

// 타입별 누적 카운터(이 프로세스 생애). /metrics가 읽어 Prometheus 텍스트로 노출한다.
const counters: Record<SecurityEventType, number> = {
  rate_limited: 0,
  forbidden: 0,
  unauthorized: 0,
};

/**
 * 보안 이벤트 1건 기록. route/사유 등 컨텍스트는 detail로 남겨 로그에서 질의 가능하게 한다.
 * 카운터 증가 + warn 로그(`security_event` 필드)를 함께 수행한다.
 */
export function recordSecurityEvent(
  type: SecurityEventType,
  detail: Record<string, unknown> = {},
): void {
  counters[type] += 1;
  log.warn("security event", { security_event: type, ...detail });
}

/** 현재 카운터 스냅샷(읽기 전용). /metrics에서 Prometheus 텍스트로 직렬화한다. */
export function securityEventCounts(): Readonly<Record<SecurityEventType, number>> {
  return counters;
}

/** Prometheus 텍스트 포맷(counter)으로 직렬화. */
export function securityEventsMetricLines(): string[] {
  const name = "dailyproof_security_events_total";
  const lines = [
    `# HELP ${name} Security-relevant denied responses by type (counter, per-process)`,
    `# TYPE ${name} counter`,
  ];
  for (const [type, value] of Object.entries(counters)) {
    lines.push(`${name}{type="${type}"} ${value}`);
  }
  return lines;
}
