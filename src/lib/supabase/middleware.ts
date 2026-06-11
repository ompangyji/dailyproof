import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER } from "@/lib/request-id";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

export async function updateSession(request: NextRequest) {
  // 요청마다 request_id 부여(클라/프록시가 보낸 게 있으면 재사용). 다운스트림은 요청 헤더로,
  // 클라이언트는 응답 헤더로 같은 ID를 받아 한 요청의 흐름을 상관할 수 있다.
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();

  // request.cookies 변경분 + request_id 를 함께 다운스트림에 전달하는 response 생성기.
  const nextWithId = () => {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };

  let response = nextWithId();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = nextWithId();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  const redirectTo = (path: string, withNext = false) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    if (withNext) url.searchParams.set("next", pathname);
    const res = NextResponse.redirect(url);
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };

  if (!user && !isPublic) return redirectTo("/login", true);
  if (user && (pathname === "/login" || pathname === "/signup")) return redirectTo("/");

  return response;
}
