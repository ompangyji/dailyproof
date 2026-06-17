import { defineConfig, devices } from "@playwright/test";

// E2E는 더미 공개키로 빌드·기동한 앱을 대상으로 돈다. 실제 Supabase 백엔드 없이도
// 결정적으로 통과하도록, 인증 안 된 흐름(미들웨어 가드·라우팅)만 검증한다.
const PORT = Number(process.env.E2E_PORT ?? 3000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// 빌드 때 인라인됐어야 할(그리고 next start가 읽을) 더미 공개값.
// 미기동 포트(127.0.0.1:54321)로 둬서 supabase 호출이 즉시 실패 → '비로그인'으로 처리되게 한다.
const dummyEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "e2e-dummy",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // 빌드된 앱(.next)을 next start로 띄운다. 로컬은 이미 떠 있으면 재사용, CI는 항상 새로 기동.
  // (사전 `npm run build`가 필요 — NEXT_PUBLIC_* 가 빌드 시점에 인라인되기 때문.)
  webServer: {
    command: "npm run start",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ...dummyEnv, PORT: String(PORT) },
  },
});
