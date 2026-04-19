import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ichiro library",
  description: "山口一郎 YouTubeライブ アーカイブ検索",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gray-950">{children}</body>
    </html>
  );
}
