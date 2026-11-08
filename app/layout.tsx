import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import Toaster from "./ui/Toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: "Isaac Borland",
  description: "Personal site and project hub.",
};

type Season = "fall" | "winter" | "spring" | "summer";

function getSeason(date: Date): Season {
  const month = date.getMonth(); // 0 = January
  if (month === 11 || month === 0 || month === 1) return "winter";
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  return "fall"; // Sep, Oct, Nov
}

// The phone's status bar takes this color, so it matches the season's background.
const seasonBg: Record<Season, string> = {
  fall: "#1d130c",
  winter: "#08111f",
  spring: "#0c1811",
  summer: "#0a181e",
};

// viewport-fit=cover lets the mobile bars sit clear of the notch and home
// indicator via env(safe-area-inset-*). interactive-widget makes Android's
// keyboard resize the layout the way iOS does.
export function generateViewport(): Viewport {
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
    themeColor: seasonBg[getSeason(new Date())],
    colorScheme: "dark",
  };
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
        <body>
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
