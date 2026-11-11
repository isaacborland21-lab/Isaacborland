import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { PublicMetadata } from "@/lib/supabaseAdmin";
import { applyRole, isRole } from "@/lib/roles";

// Gives one user a role preset (graffiti crew / jobs crew / manager / none) in one step. Owner-only.
// It only touches the job switches a role controls; the owner's own account can't be changed here.
export async function PUT(request: Request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const client = await clerkClient();
  const me = await client.users.getUser(userId);
  if ((me.publicMetadata as PublicMetadata).owner !== true) {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }

  let body: { targetUserId?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { targetUserId, role } = body;
  if (!targetUserId || typeof targetUserId !== "string" || !isRole(role)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  let target;
  try {
    target = await client.users.getUser(targetUserId);
  } catch {
    return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });
  }

  const currentMetadata = target.publicMetadata as PublicMetadata;
  if (currentMetadata.owner === true) {
    return NextResponse.json({ error: "The owner always has full access." }, { status: 400 });
  }

  const tabAdmin = applyRole(currentMetadata.tabAdmin ?? {}, role);
  try {
    await client.users.updateUserMetadata(targetUserId, {
      publicMetadata: { ...currentMetadata, tabAdmin },
    });
  } catch {
    return NextResponse.json({ error: "Failed to update the role." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tabAdmin });
}
