import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

// Lets a signed-in user manage their own dashboard calendar link(s).
// Stored in that user's Clerk privateMetadata — unlike publicMetadata
// (used for tabAdmin elsewhere in this app), privateMetadata is never
// included in the client-side user object, so a calendar link set here
// never reaches any browser except through this route's own response to
// its owner. Same comma-separated "Label=url,Label2=url2" format the old
// site-wide ICLOUD_CALENDAR_URLS env var used; see /api/calendar for where
// it's read back.

export const dynamic = "force-dynamic";

type PrivateMetadata = {
  calendarUrls?: string;
};

export async function GET() {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = (user.privateMetadata ?? {}) as PrivateMetadata;
  return NextResponse.json({ calendarUrls: meta.calendarUrls ?? "" });
}

export async function PUT(request: Request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.calendarUrls !== "string") {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const value = body.calendarUrls.trim();
  if (value.length > 4000) {
    return NextResponse.json({ error: "That's too long." }, { status: 400 });
  }

  const client = await clerkClient();
  let meta: PrivateMetadata;
  try {
    const user = await client.users.getUser(userId);
    meta = (user.privateMetadata ?? {}) as PrivateMetadata;
  } catch {
    return NextResponse.json({ error: "Couldn't load your account." }, { status: 500 });
  }

  try {
    await client.users.updateUserMetadata(userId, {
      privateMetadata: { ...meta, calendarUrls: value },
    });
  } catch {
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
