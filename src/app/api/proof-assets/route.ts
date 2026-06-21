import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/security-events";
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

const MAX_BYTES = 8 * 1024 * 1024; // 버킷 file_size_limit과 동일
const KINDS = ["doits", "pages"] as const;

// 요청 바디 shape 검증(zod). 소유 검증(source_path가 본인 폴더인지)은 user.id가 필요해
// 인증 뒤 런타임에서 별도로 한다. content_type=image/*, size 상한, kind enum은 여기서 강제.
const BodySchema = z.object({
  source_path: z.string().min(1).max(512),
  kind: z.enum(KINDS).optional(),
  content_type: z.string().startsWith("image/").optional(),
  size_bytes: z.number().int().positive().max(MAX_BYTES).optional(),
});

export async function POST(req: Request) {
  const request_id = requestIdFrom(req);
  const log = createLogger({ request_id, route: "/api/proof-assets" });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // shape 검증: content_type/size/kind/형식이 어긋나면 400.
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { source_path, kind, content_type, size_bytes } = parsed.data;

  const supabase = await createClient();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    recordSecurityEvent("unauthorized", { route: "/api/proof-assets" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // rate limit (uid 기준): 인증 사용자의 스팸 등록(→ jobs 큐·DB 적체)을 제한.
  // (근거·한도: docs/security/rate-limit.md)
  const rl = rateLimit(`proof-assets:${user.id}`, 30, 60_000);
  if (!rl.allowed) {
    recordSecurityEvent("rate_limited", { route: "/api/proof-assets", user_id: user.id });
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // 소유 검증(403): source_path는 반드시 '본인 uid 폴더'여야 한다. 아니면 타인 파일을 자기
  // asset으로 등록해 worker(service_role)가 RLS를 우회해 그 파일을 처리하게 만들 수 있다.
  const parts = source_path.split("/");
  const owned =
    parts.length === 3 &&
    parts[0] === user.id &&                  // 소유: 본인 uid 폴더
    (KINDS as readonly string[]).includes(parts[1]) &&
    /^[A-Za-z0-9._-]+$/.test(parts[2]) &&    // 파일명 안전 문자만
    !source_path.includes("..");             // path traversal 차단
  if (!owned) {
    recordSecurityEvent("forbidden", { route: "/api/proof-assets", reason: "source_path", source_path, user_id: user.id });
    return NextResponse.json({ error: "invalid source_path" }, { status: 403 });
  }
  if (kind !== undefined && kind !== parts[1]) {
    return NextResponse.json({ error: "kind mismatch" }, { status: 400 });
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
