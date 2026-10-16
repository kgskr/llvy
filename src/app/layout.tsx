import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLVY",
  description: "Replay ingestion for League custom games.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {children}
        <footer className="site-legal" aria-label="Riot Games 관련 고지">
          <p>LLVY는 Riot Games가 보증하거나 후원하는 서비스가 아닙니다.</p>
          <p lang="en">
            LLVY isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the
            views or opinions of Riot Games or anyone officially involved in
            producing or managing Riot Games properties. Riot Games, and all
            associated properties are trademarks or registered trademarks of
            Riot Games, Inc.
          </p>
          <a href="https://developer.riotgames.com/policies/general">
            Riot Games 개발자 정책
          </a>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
