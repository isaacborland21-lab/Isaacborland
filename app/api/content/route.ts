import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Returns every tab's current content as one object: { home, projects,
// about, contact }. The whole site is already gated behind Clerk sign-in
// (see middleware.ts), so this doesn't need its own auth check — anyone who
// can reach this route can already see the page that calls it.
//
// This route must always hit the database: it has no dynamic function
// (auth(), cookies(), etc.) to opt it out of Next.js's default static
// route caching, so without these exports it gets cached at build time
// and would keep serving stale content forever regardless of edits.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

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
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
