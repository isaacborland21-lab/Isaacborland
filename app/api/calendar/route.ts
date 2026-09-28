import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eventsBetween, CalendarEvent } from "@/lib/ical";

// Room dashboard calendar feed.
//
// Reads one or more iCloud "Public Calendar" links from the
// ICLOUD_CALENDAR_URLS environment variable (comma-separated; webcal:// is
// fine), expands recurring events, and returns everything from a few hours
// ago through the next 8 days, sorted. The links stay server-side — the
// browser only ever sees the events, and only when signed in.
//
// Optional: label a calendar by prefixing its link with "Name=", e.g.
//   ICLOUD_CALENDAR_URLS=Work=webcal://p1-caldav.icloud.com/...,Home=webcal://...
// Otherwise the calendar's own name from the feed is used.

export const dynamic = "force-dynamic";

const DEFAULT_TZ = process.env.DASHBOARD_TIMEZONE || "America/Denver";

type Source = { label: string | null; url: string };

function sources(): Source[] {
  const raw = process.env.ICLOUD_CALENDAR_URLS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = /^([^=]+?)=(webcals?:\/\/.+|https?:\/\/.+)$/i.exec(entry);
      const label = m ? m[1].trim() : null;
      const url = (m ? m[2] : entry).replace(/^webcals?:\/\//i, "https://");
      return { label, url };
    });
}

export async function GET() {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const list = sources();
  if (list.length === 0) {
    return NextResponse.json({ configured: false, events: [], errors: [] });
  }

  const now = Date.now();
  const windowStart = new Date(now - 12 * 3600 * 1000);
  const windowEnd = new Date(now + 8 * 86400 * 1000);

  const errors: string[] = [];
  const results = await Promise.all(
    list.map(async (src, i): Promise<CalendarEvent[]> => {
      const name = src.label || `Calendar ${i + 1}`;
      try {
        // Cached for 5 minutes on Vercel so a wall display polling all day
        // doesn't hammer iCloud.
        const res = await fetch(src.url, {
          next: { revalidate: 300 },
          headers: { Accept: "text/calendar" },
        });
        if (!res.ok) {
          errors.push(`${name}: iCloud returned ${res.status}`);
          return [];
        }
        const text = await res.text();
        if (!text.includes("BEGIN:VCALENDAR")) {
          errors.push(`${name}: link didn't return a calendar`);
          return [];
        }
        return eventsBetween(text, windowStart, windowEnd, DEFAULT_TZ, src.label);
      } catch {
        errors.push(`${name}: couldn't reach iCloud`);
        return [];
      }
    })
  );

  const events = results
    .flat()
    .sort((a, b) => (a.start === b.start ? a.title.localeCompare(b.title) : a.start.localeCompare(b.start)));

  return NextResponse.json({ configured: true, events, errors, timezone: DEFAULT_TZ });
}
