import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sanitizeSettings, SETTING_KEYS } from "@/lib/graffiti";
import { fail, isResponse, loadSettings, requireGraffiti } from "@/lib/graffitiServer";

export const dynamic = "force-dynamic";

// Billing settings hold your hourly rate, so they are owner-only (crew never see them).
export async function GET() {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;
  try {
    return NextResponse.json({ settings: await loadSettings(getSupabaseAdmin()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not load settings.", 500);
  }
}

export async function PUT(request: Request) {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON body.", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return fail("Invalid body.", 400);

  const db = getSupabaseAdmin();
  try {
    const current = await loadSettings(db);
    // merge over what's saved so a partial update never blanks the fields it didn't send
    const next = sanitizeSettings({ ...current, ...(body as Record<string, unknown>) }, current);
    const { error } = await db.from("graffiti_settings").upsert(SETTING_KEYS.map((k) => ({ k, v: next[k] })), { onConflict: "k" });
    if (error) return fail(error.message, 500);
    return NextResponse.json({ settings: next });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not save settings.", 500);
  }
}
