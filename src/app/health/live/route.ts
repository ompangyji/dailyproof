import { NextResponse } from "next/server";

// liveness probe: 프로세스가 떠서 요청을 처리하는지만 확인한다.
// 외부 의존성(DB 등)을 일부러 건드리지 않는다 — "살아있나"와 "준비됐나"는 분리(readiness가 후자).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
