import { Webhook } from "svix";
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { DEFAULT_TAB_ADMIN, PublicMetadata } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ClerkWebhookEvent = {
  type: string;
  data: { id: string };
};

export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("CLERK_WEBHOOK_SECRET is not configured; ignoring webhook.");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers." }, { status: 400 });
  }

  // Must read the raw, unparsed body — svix verifies the exact bytes Clerk
  // signed.
  const rawBody = await request.text();

  let event: ClerkWebhookEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event.type === "user.created") {
    const userId = event.data.id;
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      const currentMetadata = (user.publicMetadata ?? {}) as PublicMetadata;

      // Never downgrade or clobber: only fill in tabAdmin if this user
      // doesn't already have one (e.g. owner metadata set by hand before
      // the webhook fired).
      if (!currentMetadata.tabAdmin) {
        await client.users.updateUserMetadata(userId, {
          publicMetadata: { ...currentMetadata, tabAdmin: DEFAULT_TAB_ADMIN },
        });
      }
    } catch (err) {
      console.error("Failed to set default permissions for new user", userId, err);
      // Return 200 anyway: Clerk retries non-2xx responses, and a retry
      // won't fix a genuinely bad/missing user id.
    }
  }

  return NextResponse.json({ ok: true });
}
