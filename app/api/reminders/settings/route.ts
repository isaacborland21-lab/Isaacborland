import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

// Lets a signed-in user manage their own Apple Reminders credentials.
//
// Apple has no "public link" sharing for Reminders the way it does for
// Calendar, so reading someone's reminders needs their Apple ID plus an
// app-specific password (created at appleid.apple.com -> Sign-In and
// Security -> App-Specific Passwords — never their real Apple ID
// password). Both are stored in that user's own Clerk privateMetadata,
// same as the calendar links in /api/calendar/settings, and never reach
// any browser except through this route's own response to its owner —
// and even then, the password itself is never sent back down once it's
// been saved; GET only reports whether one is on file.

export const dynamic = "force-dynamic";

type PrivateMetadata = {
  calendarUrls?: string;
  remindersAppleId?: string;
  remindersAppPassword?: string;
};

export async function GET() {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = (user.privateMetadata ?? {}) as PrivateMetadata;
  return NextResponse.json({
    appleId: meta.remindersAppleId ?? "",
    hasPassword: Boolean(meta.remindersAppPassword),
  });
}

export async function PUT(request: Request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.appleId !== "string") {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const appleId = body.appleId.trim();
  if (appleId.length > 320) {
    return NextResponse.json({ error: "That's too long." }, { status: 400 });
  }
  if (typeof body.appPassword === "string" && body.appPassword.trim().length > 64) {
    return NextResponse.json({ error: "That app-specific password looks wrong." }, { status: 400 });
  }

  const client = await clerkClient();
  let meta: PrivateMetadata;
  try {
    const user = await client.users.getUser(userId);
    meta = (user.privateMetadata ?? {}) as PrivateMetadata;
  } catch {
    return NextResponse.json({ error: "Couldn't load your account." }, { status: 500 });
  }

  const next: PrivateMetadata = { ...meta, remindersAppleId: appleId };
  if (typeof body.appPassword === "string" && body.appPassword.trim()) {
    next.remindersAppPassword = body.appPassword.trim();
  }
  if (body.clearPassword === true) {
    delete next.remindersAppPassword;
  }
  if (body.clearAll === true) {
    delete next.remindersAppleId;
    delete next.remindersAppPassword;
  }

  try {
    await client.users.updateUserMetadata(userId, { privateMetadata: next });
  } catch {
    return NextResponse.json({ error: "Failed to save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
