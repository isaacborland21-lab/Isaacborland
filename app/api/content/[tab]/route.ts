import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabaseAdmin, isValidTab, canEditTab, PublicMetadata } from "@/lib/supabaseAdmin";

export async function PUT(request: Request, { params }: { params: { tab: string } }) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const tab = params.tab;
  if (!isValidTab(tab)) {
    return NextResponse.json({ error: "Unknown tab." }, { status: 400 });
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const metadata = user.publicMetadata as PublicMetadata;

  if (!canEditTab(metadata, tab)) {
    return NextResponse.json({ error: "Not permitted to edit this tab." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("tab_content")
    .update({ content: body, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("tab", tab);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
