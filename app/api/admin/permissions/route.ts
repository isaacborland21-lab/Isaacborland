import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isValidTab, PublicMetadata } from "@/lib/supabaseAdmin";

// Grants or revokes one user's edit rights for one tab. Owner-only.
export async function PUT(request: Request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const client = await clerkClient();
  const me = await client.users.getUser(userId);
  const myMetadata = me.publicMetadata as PublicMetadata;

  if (myMetadata.owner !== true) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }

  let body: { targetUserId?: string; tab?: string; allowed?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { targetUserId, tab, allowed } = body;
  if (!targetUserId || !tab || !isValidTab(tab) || typeof allowed !== "boolean") {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  let target;
  try {
    target = await client.users.getUser(targetUserId);
  } catch {
    return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });
  }

  const currentMetadata = target.publicMetadata as PublicMetadata;
  const nextTabAdmin = { ...(currentMetadata.tabAdmin ?? {}), [tab]: allowed };

  try {
    await client.users.updateUserMetadata(targetUserId, {
      publicMetadata: { ...currentMetadata, tabAdmin: nextTabAdmin },
    });
  } catch {
    return NextResponse.json({ error: "Failed to update permissions." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
