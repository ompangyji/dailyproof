// 앱 레벨 in-memory 고정 윈도우(fixed-window) rate limiter.
//
// 한계(의도적으로 단순): 다중 pod에선 인스턴스마다 카운터가 분리돼 per-pod로만 적용되고,
// 프로세스 재시작 시 초기화된다. 단일 노드 데모에서 '통제의 존재·동작'을 실증하는 용도이며,
// 진짜 운영의 분산 rate limit은 edge(Traefik Middleware)/Redis로 둔다.
// 설계·대상 선정 근거: docs/security/rate-limit.md

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000; // 메모리 폭주 방지(고유 IP/uid 키 누적). 초과 시 만료분 정리.

export type RateResult = {
  allowed: boolean;
  retryAfter: number; // 초과 시 재시도까지 남은 초
  remaining: number; // 이번 윈도우 잔여 허용 횟수
};

/**
 * key별로 windowMs 동안 limit회까지 허용. 초과하면 allowed=false + retryAfter(초).
 * 예: rateLimit(`grass:${ip}`, 60, 60_000)
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || now >= b.resetAt) {
    if (buckets.size >= MAX_KEYS) prune(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0, remaining: limit - 1 };
  }
  if (b.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((b.resetAt - now) / 1000), remaining: 0 };
  }
  b.count += 1;
  return { allowed: true, retryAfter: 0, remaining: limit - b.count };
}

/** 만료된 버킷 정리(메모리 누수 방지). */
function prune(now: number): void {
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}

/** 클라이언트 IP 추출(프록시/Ingress가 설정하는 헤더 우선). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
