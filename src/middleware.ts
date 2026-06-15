import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // `api/grass`(공개 임베드)와 `health`(probe)는 auth/session 처리에서 제외한다.
  // 특히 liveness가 미들웨어의 Supabase 세션 조회에 의존하지 않도록 health를 통째로 뺀다.
  matcher: [
    "/((?!api/grass|health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
