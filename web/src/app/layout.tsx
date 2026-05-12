import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "KoeScope",
  description: "Local Bangumi voice actor work search and DLsite monitor helper.",
  icons: {
    icon: "/assets/koescope-icon-32.png",
    apple: "/assets/koescope-icon-256.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/theme.css" />
        <link rel="stylesheet" href="/styles.css" />
        <link rel="stylesheet" href="/person.css" />
        <link rel="stylesheet" href="/dashboard.css" />
        <link rel="stylesheet" href="/enterprise.css" />
      </head>
      <body>
        <ThemeProvider>
          <div className="next-root">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
