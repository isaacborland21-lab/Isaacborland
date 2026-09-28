import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Isaac Borland",
  description: "Personal site and project hub.",
};

// viewport-fit=cover lets the mobile bottom bar sit above the iPhone home
// indicator via env(safe-area-inset-bottom).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d130c",
};

type Season = "fall" | "winter" | "spring" | "summer";

function getSeason(date: Date): Season {
  const month = date.getMonth(); // 0 = January
  if (month === 11 || month === 0 || month === 1) return "winter";
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  return "fall"; // Sep, Oct, Nov
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const season = getSeason(new Date());

  return (
    <ClerkProvider>
      <html lang="en" data-season={season}>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
            rel="stylesheet"
          />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
