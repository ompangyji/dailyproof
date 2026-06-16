import { NextResponse } from "next/server";
import { trace } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/log";
import { requestIdFrom } from "@/lib/request-id";

// 현재 활성 web span에서 W3C traceparent 문자열을 직접 만든다.
// (전역 propagator 설정에 의존하지 않아 더 견고. 형식: 00-<trace-id>-<span-id>-<flags>)
function activeTraceparent(): string | null {
  const sc = trace.getActiveSpan()?.spanContext();
  if (!sc?.traceId || sc.traceId === "0".repeat(32)) return null;
  const flags = (sc.traceFlags ?? 0).toString(16).padStart(2, "0");
  return `00-${sc.traceId}-${sc.spanId}-${flags}`;
}

// 업로드된 원본을 비동기 후처리 대상으로 등록한다(파일 자체는 브라우저가 Storage로 직행).
// 이 등록을 서버 경유로 둔 이유: @vercel/otel이 이 라우트를 span으로 감싸므로,
// 그 active 컨텍스트를 W3C traceparent로 추출해 asset row에 심어둘 수 있다.
// → worker가 그 traceparent를 부모로 복원해 web→worker→DB가 한 trace로 이어진다.
export const dynamic = "force-dynamic";

type Body = {
  source_path?: string;
  kind?: "doits" | "pages";
  content_type?: string;
  size_bytes?: number;
};

export async function POST(req: Request) {
  const request_id = requestIdFrom(req);
  const log = createLogger({ request_id, route: "/api/proof-assets" });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { source_path, kind, content_type, size_bytes } = body;
  if (!source_path) {
    return NextResponse.json({ error: "source_path required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 현재 web span의 컨텍스트를 W3C traceparent 문자열로 추출 → asset row에 저장.
  const traceparent = activeTraceparent();
  const trace_id = randomUUID(); // 로그 상관용(기존 유지)

  const { data, error } = await supabase
    .from("proof_assets")
    .insert({
      user_id: user.id,
      source_path,
      trace_id,
      traceparent,
      kind,
      status: "uploaded",
      content_type,
      size_bytes,
    })
    .select("id")
    .single();

  if (error) {
    log.warn("asset 등록 실패", { error: error.message, trace_id });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  log.info("asset 등록", { asset_id: data.id, trace_id, has_traceparent: !!traceparent });
  return NextResponse.json({ id: data.id, trace_id }, { status: 201 });
}
