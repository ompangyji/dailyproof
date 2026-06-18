import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createLogger } from "@/lib/log";
import { requestIdFrom } from "@/lib/request-id";

// Prometheus 텍스트 포맷 메트릭. 전역 상태별 카운트를 metrics_snapshot()(SECURITY DEFINER,
// 집계만 반환)에서 받아 게이지로 노출한다. Prometheus가 주기적으로 scrape(추후 k3s).
// 인증 제외(미들웨어 matcher) — 운영에선 내부망 제한 [추후].
export const dynamic = "force-dynamic";

const JOB_STATUSES = ["pending", "processing", "done", "failed"];
const ASSET_STATUSES = ["uploaded", "processing", "ready", "failed"];

function gauge(name: string, help: string, by: Record<string, number> | undefined, statuses: string[]): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
  for (const s of statuses) lines.push(`${name}{status="${s}"} ${by?.[s] ?? 0}`);
  return lines;
}

const TEXT_HEADERS = { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" };

// 부하 진단 결과: 쿼리(3.6ms)·REST API(~130ms)는 빠른데 앱 pod에서 나가는 RPC만 ~10초로 굳었다.
// (pod의 Supabase 연결이 stale해진 keep-alive를 재사용하다 소켓 타임아웃을 때리는 패턴)
// → ① 짧은 TTL 캐시 + single-flight로 동시 부하의 DB 폭증을 막고,
//    ② rpc에 fail-fast 타임아웃을 걸어 행을 2초에 끊고(다음 호출은 새 연결로 자가복구),
//    ③ 신선화 실패 시 직전 정상값(stale)을 반환해 /metrics가 10초 행 없이 살아 있게 한다.
const TTL_MS = Number(process.env.METRICS_CACHE_TTL_MS ?? 3000);
const RPC_TIMEOUT_MS = Number(process.env.METRICS_RPC_TIMEOUT_MS ?? 2000);
const STALE_MAX_MS = Number(process.env.METRICS_STALE_MAX_MS ?? 30000);

let cache: { at: number; body: string } | null = null;
let inflight: Promise<string> | null = null;

async function buildSnapshotBody(): Promise<string> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  // fail-fast: 행 걸린 연결을 RPC_TIMEOUT_MS에 abort → 그 소켓을 버리고 다음 호출은 새 연결로.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const { data, error } = await sb.rpc("metrics_snapshot").abortSignal(controller.signal);
    if (error || !data) throw new Error(error?.message ?? "metrics_snapshot: no data");

    const snap = data as {
      jobs?: Record<string, number>;
      assets?: Record<string, number>;
      job_processing_seconds_avg?: number;
    };
    return [
      ...gauge("dailyproof_jobs_total", "Jobs by status (pending = queue depth)", snap.jobs, JOB_STATUSES),
      ...gauge("dailyproof_assets_total", "Proof assets by status (failed = upload/처리 실패)", snap.assets, ASSET_STATUSES),
      "# HELP dailyproof_job_processing_seconds_avg Recent avg job processing time claim→done (seconds), approx",
      "# TYPE dailyproof_job_processing_seconds_avg gauge",
      `dailyproof_job_processing_seconds_avg ${snap.job_processing_seconds_avg ?? 0}`,
      "",
    ].join("\n");
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  const log = createLogger({ request_id: requestIdFrom(req), route: "/metrics" });

  // 1) 신선한 캐시면 DB를 안 친다.
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return new NextResponse(cache.body, { status: 200, headers: TEXT_HEADERS });
  }

  // 2) 캐시 미스 — 동시 요청은 같은 in-flight 조회를 공유한다(single-flight).
  //    (JS 단일 스레드라 check→assign 사이엔 await가 없어 첫 요청만 조회를 시작한다.)
  try {
    if (!inflight) {
      inflight = buildSnapshotBody().finally(() => {
        inflight = null;
      });
    }
    const body = await inflight;
    cache = { at: Date.now(), body };
    return new NextResponse(body, { status: 200, headers: TEXT_HEADERS });
  } catch (e) {
    // 3) 신선화 실패 — 직전 정상값(stale)이 너무 오래되지 않았으면 그걸로 응답(10초 행보다 낫다).
    if (cache && Date.now() - cache.at < STALE_MAX_MS) {
      log.warn("metrics 신선화 실패 — stale 캐시 반환", { error: (e as Error).message });
      return new NextResponse(cache.body, { status: 200, headers: { ...TEXT_HEADERS, "X-Metrics-Stale": "1" } });
    }
    log.warn("metrics 수집 실패", { error: (e as Error).message });
    return new NextResponse(`# metrics unavailable\n`, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
