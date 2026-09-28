import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Returns every tab's current content as one object: { home, projects,
// about, contact }. The whole site is already gated behind Clerk sign-in
// (see middleware.ts), so this doesn't need its own auth check — anyone who
// can reach this route can already see the page that calls it.
export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("tab_content").select("tab, content");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result: Record<string, unknown> = {};
  for (const row of data ?? []) {
    result[row.tab] = row.content;
  }
  return NextResponse.json(result);
}
