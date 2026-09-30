import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { fetchReminders } from "@/lib/caldav";

// Room dashboard reminders feed.
//
// Per-account, same as /api/calendar: each signed-in user's dashboard
// shows only their own Apple Reminders, read with their own Apple ID +
// app-specific password (see /api/reminders/settings and the
// "Reminders" button on the dashboard page). Completed and cancelled
// items are filtered out here; everything else is sorted soonest-due
// first, with no-due-date items last.

export const dynamic = "force-dynamic";

type PrivateMetadata = {
  remindersAppleId?: string;
  remindersAppPassword?: string;
};

export async function GET() {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let meta: PrivateMetadata = {};
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    meta = (user.privateMetadata ?? {}) as PrivateMetadata;
  } catch {
    // Treat a failure to load the account the same as "nothing configured"
    // rather than breaking the whole dashboard over it.
    return NextResponse.json({ configured: false, lists: [], errors: [] });
  }

  const { remindersAppleId, remindersAppPassword } = meta;
  if (!remindersAppleId || !remindersAppPassword) {
    return NextResponse.json({ configured: false, lists: [], errors: [] });
  }

  try {
    const lists = await fetchReminders(remindersAppleId, remindersAppPassword);
    return NextResponse.json({ configured: true, lists, errors: [] });
  } catch (e) {
    return NextResponse.json({
      configured: true,
      lists: [],
      errors: [(e as Error).message || "Couldn't reach iCloud Reminders."],
    });
  }
}
