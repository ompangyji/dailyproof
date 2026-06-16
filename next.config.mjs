/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 컨테이너용 최소 산출물(.next/standalone): 서버 실행에 필요한 파일·의존성만 추려
  // 작은 런타임 이미지를 만든다(node server.js 로 기동).
  output: "standalone",
};

export default nextConfig;
