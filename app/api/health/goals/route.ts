import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PublicMetadata } from "@/lib/supabaseAdmin";

// Sets the activity-ring goals shown on /dashboard. These never come from
// the phone (see lib/health.ts for why) — the owner sets them here instead,
// the same "click Edit, type numbers, Save" pattern as the site's other
// editable tabs. Owner-only, same as the Admin tab.

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const metadata = user.publicMetadata as PublicMetadata;
  if (metadata.owner !== true) {
    return NextResponse.json({ error: "Not permitted to change goals." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const move_kcal = Number(b.move_kcal);
  const exercise_min = Number(b.exercise_min);
  const stand_hours = Number(b.stand_hours);
  if (![move_kcal, exercise_min, stand_hours].every((n) => Number.isFinite(n) && n > 0)) {
    return NextResponse.json({ error: "move_kcal, exercise_min and stand_hours must all be positive numbers." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: existing, error: readError } = await supabase
    .from("health_metrics")
    .select("metrics")
    .eq("id", "latest")
    .single();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const current = (existing?.metrics as Record<string, unknown>) ?? {};
  const merged = { ...current, goals: { move_kcal, exercise_min, stand_hours } };

  const { error: writeError } = await supabase.from("health_metrics").update({ metrics: merged }).eq("id", "latest");
  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
