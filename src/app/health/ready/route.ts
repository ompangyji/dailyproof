import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createLogger } from "@/lib/log";
import { requestIdFrom } from "@/lib/request-id";
import { isShuttingDown } from "@/lib/lifecycle";

// readiness probe: 트래픽을 받을 준비가 됐는지. 의존성(Supabase 도달)을 점검해
// 준비됐으면 200, 아니면 503 + 어떤 체크가 실패했는지 본문에 노출한다. k3s readiness probe 대응.
// (checks의 db는 다음 단계에서 timeout/retry 래퍼로 감싸 attempts·timeout까지 드러낼 예정.)
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const log = createLogger({ request_id: requestIdFrom(req), route: "/health/ready" });

  // 종료 중이면 DB 점검과 무관하게 not-ready(503) → 오케스트레이터가 트래픽을 뺀다.
  if (isShuttingDown()) {
    const body = { ready: false, checks: { shutdown: { ok: false, reason: "shutting_down" } } };
    log.warn("readiness check — 종료 중(graceful shutdown)", body);
    return NextResponse.json(body, { status: 503 });
  }

  const started = Date.now();
  let ok = false;
  let error: string | undefined;
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    // 연결 확인용 가벼운 조회. RLS로 행이 없어도(에러 아님) DB 도달 자체는 확인된다.
    const res = await sb.from("proof_assets").select("id").limit(1);
    if (res.error) throw new Error(res.error.message);
    ok = true;
  } catch (e) {
    error = (e as Error).message;
  }
  const ms = Date.now() - started;

  const body = {
    ready: ok,
    checks: { db: { ok, ms, ...(error ? { error } : {}) } },
  };
  if (ok) log.info("readiness check", body);
  else log.warn("readiness check 실패", body);

  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
