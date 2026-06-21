import type { Metadata } from "next";
import { headers } from "next/headers";
import { Bowlby_One, Inter_Tight, Knewave } from "next/font/google";
import "./globals.css";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
  display: "swap",
});

const bowlbyOne = Bowlby_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const knewave = Knewave({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-tag",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DailyProof",
  description: "Log your daily routines and moments on the calendar.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 미들웨어가 심은 요청별 CSP nonce를 읽는다. headers() 호출 자체가 앱을 '동적 렌더'로
  // 전환시켜, Next가 자기 <script>에 이 요청의 nonce를 부여하게 한다(정적 prerender면 빌드
  // 타임 스크립트에 nonce가 없어 strict-dynamic CSP가 하이드레이션을 통째로 막는다).
  await headers();
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${bowlbyOne.variable} ${knewave.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
