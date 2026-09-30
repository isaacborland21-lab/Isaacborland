import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { eventsBetween, CalendarEvent } from "@/lib/ical";

// Room dashboard calendar feed.
//
// Per-account: each signed-in user's dashboard shows only their own
// calendar link(s), read from their own Clerk privateMetadata (set via
// PUT /api/calendar/settings — see that route, and the "Calendar" button
// on the dashboard page). privateMetadata never reaches the browser as
// part of the Clerk user object, so this stays server-side the same way
// the old site-wide env var did; it's just scoped per user now instead of
// shared across everyone who happens to be signed in.
//
// Expands recurring events and returns everything from a few hours ago
// through the next 8 days, sorted.
//
// Optional: label a calendar by prefixing its link with "Name=", e.g.
//   Work=webcal://p1-caldav.icloud.com/...,Home=webcal://...
// Otherwise the calendar's own name from the feed is used.

export const dynamic = "force-dynamic";

const DEFAULT_TZ = process.env.DASHBOARD_TIMEZONE || "America/Denver";

type Source = { label: string | null; url: string };

function parseSources(raw: string): Source[] {
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

  let raw = "";
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    raw = (user.privateMetadata as { calendarUrls?: string } | null)?.calendarUrls || "";
  } catch {
    // Treat a failure to load the account the same as "nothing configured"
    // rather than breaking the whole dashboard over it.
  }

  const list = parseSources(raw);
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
