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

export async function GET(req: Request) {
  const log = createLogger({ request_id: requestIdFrom(req), route: "/metrics" });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await sb.rpc("metrics_snapshot");
  if (error || !data) {
    log.warn("metrics 수집 실패", { error: error?.message });
    return new NextResponse(`# metrics unavailable\n`, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const snap = data as {
    jobs?: Record<string, number>;
    assets?: Record<string, number>;
    job_processing_seconds_avg?: number;
  };
  const body = [
    ...gauge("dailyproof_jobs_total", "Jobs by status (pending = queue depth)", snap.jobs, JOB_STATUSES),
    ...gauge("dailyproof_assets_total", "Proof assets by status (failed = upload/처리 실패)", snap.assets, ASSET_STATUSES),
    "# HELP dailyproof_job_processing_seconds_avg Recent avg job processing time claim→done (seconds), approx",
    "# TYPE dailyproof_job_processing_seconds_avg gauge",
    `dailyproof_job_processing_seconds_avg ${snap.job_processing_seconds_avg ?? 0}`,
    "",
  ].join("\n");

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" },
  });
}
