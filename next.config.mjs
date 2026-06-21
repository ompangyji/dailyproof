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
  // 컨테이너용 최소 산출물(.next/standalone): 서버 실행에 필요한 파일·의존성만 추려
  // 작은 런타임 이미지를 만든다(node server.js 로 기동).
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
