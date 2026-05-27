import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${bowlbyOne.variable} ${knewave.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
