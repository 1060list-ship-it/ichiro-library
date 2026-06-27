import type { Metadata } from "next";
import PublicSiteHeader from "@/components/PublicSiteHeader";
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
    <html lang="ja" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-gray-950">
        <PublicSiteHeader />
        {children}
      </body>
    </html>
  );
}
