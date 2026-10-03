import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
