import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { currentUser, SuggestionRow, toView } from "@/lib/suggestions";

// GET  /api/suggestions  -> every suggestion (newest first) for any signed-in user
// POST /api/suggestions  -> submit a new suggestion; any signed-in user may

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_PENDING_PER_USER = 20;

export async function GET() {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("project_suggestions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const me = await currentUser(userId);
  const suggestions = ((data ?? []) as SuggestionRow[]).map((r) => toView(r, userId));
  return NextResponse.json({ suggestions, canReview: me.canReview }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let title = "";
  let details = "";
  try {
    const body = (await request.json()) as { title?: unknown; details?: unknown };
    title = typeof body.title === "string" ? body.title.trim() : "";
    details = typeof body.details === "string" ? body.details.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!title) return NextResponse.json({ error: "Give the idea a title." }, { status: 400 });
  if (title.length > 120) return NextResponse.json({ error: "Keep the title under 120 characters." }, { status: 400 });
  if (details.length > 2000) return NextResponse.json({ error: "Keep the details under 2,000 characters." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { count } = await supabase
    .from("project_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("submitter_id", userId)
    .eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING_PER_USER) {
    return NextResponse.json({ error: `You have ${MAX_PENDING_PER_USER} ideas waiting for review already.` }, { status: 429 });
  }

  const me = await currentUser(userId);
  const { data, error } = await supabase
    .from("project_suggestions")
    .insert({ title, details, submitter_id: userId, submitter_name: me.name })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ suggestion: toView(data as SuggestionRow, userId) });
}
