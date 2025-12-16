import type { Metadata } from "next";
import "./globals.css";
import { PortalStyleFix } from "./portal-style-fix";

export const metadata: Metadata = {
  title: "Macro Relationship Engine | MVP",
  description: "Real-time makroekonomisk analys och regime-detektion",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PortalStyleFix />
        {children}
      </body>
    </html>
  );
}

