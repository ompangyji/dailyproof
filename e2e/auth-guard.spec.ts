import { test, expect } from "@playwright/test";

// 미들웨어 인증 가드(src/middleware.ts → lib/supabase/middleware.ts).
// 실제 Supabase 백엔드 없이(더미 공개키) 결정적으로 통과하는 흐름만 검증한다.

test("비로그인 사용자는 보호 경로(/)에서 /login?next=로 리다이렉트된다", async ({ page }) => {
  await page.goto("/");

  // 미들웨어가 user 없음 → /login?next=<원래 경로> 로 보낸다.
  await expect(page).toHaveURL(/\/login\?next=%2F$/);

  // 로그인 화면이 실제로 렌더되는지(헤딩 + 폼 요소).
  await expect(page.getByRole("heading", { name: "DailyProof" })).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("로그인 화면의 Sign up 링크로 회원가입 페이지로 이동한다", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});
