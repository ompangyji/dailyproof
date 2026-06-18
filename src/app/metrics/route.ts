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

// 짧은 TTL 인메모리 캐시 + single-flight.
// 부하 측정에서 매 요청이 metrics_snapshot RPC를 직접 쳐 동시성 20VU에 DB 커넥션이 포화 →
// 모든 요청이 ~10s 타임아웃·100% 실패했다. TTL 동안 결과를 재사용하고, 캐시 미스 시
// 동시 요청은 '진행 중인 한 번의 조회'를 공유(single-flight)해 DB 호출을 1회로 합친다.
// (메트릭은 약간의 staleness를 허용 가능 — scrape 주기보다 짧게 둔다.)
const TTL_MS = Number(process.env.METRICS_CACHE_TTL_MS ?? 3000);
let cache: { at: number; body: string } | null = null;
let inflight: Promise<string> | null = null;

async function buildSnapshotBody(): Promise<string> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await sb.rpc("metrics_snapshot");
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
}

export async function GET(req: Request) {
  const log = createLogger({ request_id: requestIdFrom(req), route: "/metrics" });

  // 1) 신선한 캐시면 DB를 안 친다.
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return new NextResponse(cache.body, { status: 200, headers: TEXT_HEADERS });
  }

  // 2) 캐시 미스 — 동시 요청은 같은 in-flight 조회를 공유한다(single-flight).
  //    (JS 단일 스레드라 아래 check→assign 사이엔 await가 없어 첫 요청만 조회를 시작한다.)
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
    log.warn("metrics 수집 실패", { error: (e as Error).message });
    return new NextResponse(`# metrics unavailable\n`, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
