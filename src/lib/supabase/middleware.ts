import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER } from "@/lib/request-id";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

// 요청별 nonce 기반 CSP를 만든다. script-src는 nonce + strict-dynamic(Next 부트스트랩
// 스크립트가 nonce로 신뢰되면 그게 로드하는 청크도 신뢰)로 인라인 스크립트 XSS를 차단한다.
// style-src는 React inline style·Tailwind 때문에 'unsafe-inline' 허용. img/connect는
// same-origin + Supabase. next/font는 self-host라 font-src 'self'면 충분.
// dev에선 HMR(React Refresh)이 eval·websocket을 써서 'unsafe-eval'·ws:를 추가한다.
// 설계 근거: docs/security/security-headers-plan.md
function buildCsp(nonce: string): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const dev = process.env.NODE_ENV !== "production";
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: ${supabase}`.trim(),
    `font-src 'self'`,
    `connect-src 'self' ${supabase}${dev ? " ws:" : ""}`.trim(),
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];
  return directives.join("; ");
}

export async function updateSession(request: NextRequest) {
  // 요청마다 request_id 부여(클라/프록시가 보낸 게 있으면 재사용). 다운스트림은 요청 헤더로,
  // 클라이언트는 응답 헤더로 같은 ID를 받아 한 요청의 흐름을 상관할 수 있다.
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();

  // 요청별 CSP nonce. 다운스트림(서버 컴포넌트)이 x-nonce로 읽어 인라인 <script>에 부여한다.
  // (미들웨어는 Edge 런타임이라 Buffer 대신 btoa 사용.)
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // request.cookies 변경분 + request_id + nonce 를 함께 다운스트림에 전달하는 response 생성기.
  // CSP는 report-only로 전 기능 관찰(위반 0 확인) 후 enforce로 전환했다.
  const nextWithId = () => {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    headers.set("x-nonce", nonce);
    // 요청 헤더에 enforcing 이름으로 실어 Next가 nonce를 추출해 자기 <script>에 부여하게 한다.
    // (응답은 아래에서 Report-Only로만 내보내므로 브라우저는 차단하지 않고 보고만 한다.)
    headers.set("Content-Security-Policy", csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set(REQUEST_ID_HEADER, requestId);
    // report-only로 전 기능 관찰해 위반 0 확인 후 enforce로 승격(차단 활성화).
    res.headers.set("Content-Security-Policy", csp);
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
