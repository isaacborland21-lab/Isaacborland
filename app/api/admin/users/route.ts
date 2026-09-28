import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { PublicMetadata } from "@/lib/supabaseAdmin";

// Lists every signed-up user and their current per-tab permissions.
// Owner-only: this is how admin rights get handed out in the first place.
export async function GET() {
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

  const list = await client.users.getUserList({ limit: 100 });
  const users = list.data.map((u) => {
    const metadata = u.publicMetadata as PublicMetadata;
    const primaryEmail =
      u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      "";
    return {
      id: u.id,
      email: primaryEmail,
      firstName: u.firstName,
      owner: metadata.owner === true,
      tabAdmin: metadata.tabAdmin ?? {},
    };
  });

  return NextResponse.json({ users });
}
