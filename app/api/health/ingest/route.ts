import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { extractIngestFields } from "@/lib/health";

// Where Isaac's iPhone pushes today's step count and activity totals.
//
// This route deliberately does NOT use Clerk — a Shortcuts automation on
// his phone can't hold a browser session or click through a sign-in flow.
// It's a public route (see middleware.ts) protected instead by a shared
// secret, sent as a header, that only Isaac's Shortcut and this server
// know. Anyone without that secret gets a 401 and nothing is written.

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.HEALTH_INGEST_SECRET;
  if (!expected) return false; // never accept writes if the secret isn't configured
  const got = request.headers.get("x-dashboard-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on mismatched lengths, so pad first — the length
  // check that follows still rejects a wrong-length secret, just without
  // leaking timing information about *why* it's wrong.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fields = extractIngestFields(body);
  if (Object.keys(fields).length === 0) {
    return NextResponse.json(
      { error: "No recognized fields. Expected steps, move_kcal, exercise_min, stand_hours." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  // Merge onto the existing row rather than overwrite: a sync that only
  // sends steps (say, a quick automation) shouldn't blank out this
  // morning's exercise/stand numbers, and never touches "goals" at all —
  // those are only ever set through /api/health/goals.
  const { data: existing, error: readError } = await supabase
    .from("health_metrics")
    .select("metrics")
    .eq("id", "latest")
    .single();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const current = (existing?.metrics as Record<string, unknown>) ?? {};
  const merged = { ...current, ...fields };

  const { error: writeError } = await supabase
    .from("health_metrics")
    .update({ metrics: merged, source: "ingest", updated_at: new Date().toISOString() })
    .eq("id", "latest");

  if (writeError) {
    return NextResponse.json({ error: writeError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, stored: fields });
}
