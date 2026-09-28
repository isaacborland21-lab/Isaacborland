import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DEFAULT_GOALS, emptyMetrics, HealthMetrics } from "@/lib/health";

// Read side for the dashboard's activity rings: the latest snapshot
// /api/health/ingest has stored, whatever last wrote to it.

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("health_metrics").select("metrics, updated_at").eq("id", "latest").single();

  if (error) {
    // No row yet (table exists but was never seeded) isn't a real error —
    // the dashboard should just show "not connected", same as calendar.
    if (error.code === "PGRST116") {
      return NextResponse.json({ configured: false, metrics: emptyMetrics(), updatedAt: null });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stored = (data?.metrics as Record<string, unknown>) ?? {};
  const metrics: HealthMetrics = {
    steps: typeof stored.steps === "number" ? stored.steps : null,
    move_kcal: typeof stored.move_kcal === "number" ? stored.move_kcal : null,
    exercise_min: typeof stored.exercise_min === "number" ? stored.exercise_min : null,
    stand_hours: typeof stored.stand_hours === "number" ? stored.stand_hours : null,
    sample_date: typeof stored.sample_date === "string" ? stored.sample_date : null,
    goals: { ...DEFAULT_GOALS, ...(stored.goals as object | undefined) },
  };

  const configured = metrics.steps !== null || metrics.move_kcal !== null || metrics.exercise_min !== null || metrics.stand_hours !== null;

  return NextResponse.json({ configured, metrics, updatedAt: data?.updated_at ?? null });
}
