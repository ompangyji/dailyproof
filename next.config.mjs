// 정적 보안 헤더(모든 응답에 적용 — 미들웨어 matcher가 제외하는 grass·정적자산에도 붙음).
// 값·근거: docs/security/security-headers-plan.md. CSP는 요청별 nonce가 필요해 여기 두지 않고
// 미들웨어에서 설정한다(현재 Report-Only). HSTS는 preload 제외(롤백 비용 — retrospective/hsts-preload.md).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 기술스택 노출 헤더 제거(X-Powered-By: Next.js). 방어가 아니라 '정보 노출 최소화' —
  // CSP 같은 강제형 통제와 달리, 굳이 공격자에게 줄 필요 없는 힌트는 줄인다.
  // (CSP는 숨기지 않는다 — 브라우저가 받아야 강제되므로. 근거: retrospective/csp-not-secret.md)
  poweredByHeader: false,
  // 컨테이너용 최소 산출물(.next/standalone): Docker 빌드에서만 켠다(BUILD_STANDALONE=1).
  //   standalone은 `next start`와 비호환("next start does not work with output: standalone")이라,
  //   e2e(next start)·일반 빌드에선 끄고 표준 빌드를 쓴다. 안 그러면 CSP nonce가 의존하는
  //   요청별 동적 렌더가 깨져 하이드레이션이 막힌다. Vercel은 output을 무시하므로 영향 없음.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
