import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isJobType } from "@/lib/jobs";
import { JOB_SETTING_KEYS, sanitizeJobSettings, settingKey } from "@/lib/jobInvoice";
import { fail, isResponse } from "@/lib/graffitiServer";
import { loadJobSettings, requireJobs } from "@/lib/jobsServer";

export const dynamic = "force-dynamic";

// This job type's rate, minimum, rounding and Bill to / PO numbers. They hold your prices, so owner-only.
// (Business name, address, payment terms and time zone are shared with graffiti: edit them on Graffiti → Invoice.)
async function ownerOnly(type: string) {
  if (!isJobType(type)) return fail("Unknown job type.", 404);
  const who = await requireJobs(type);
  if (isResponse(who)) return who;
  if (!who.owner) return fail("Owner only.", 403);
  return type;
}

export async function GET(_request: Request, { params }: { params: { type: string } }) {
  const type = await ownerOnly(params.type);
  if (isResponse(type)) return type;
  try {
    const { job } = await loadJobSettings(getSupabaseAdmin(), type);
    return NextResponse.json({ settings: job }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not load settings.", 500);
  }
}

export async function PUT(request: Request, { params }: { params: { type: string } }) {
  const type = await ownerOnly(params.type);
  if (isResponse(type)) return type;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON body.", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return fail("Invalid body.", 400);

  const db = getSupabaseAdmin();
  try {
    const { job: current } = await loadJobSettings(db, type);
    // merge over what's saved so a partial update never blanks the fields it didn't send
    const next = sanitizeJobSettings({ ...current, ...(body as Record<string, unknown>) }, current);
    const { error } = await db
      .from("graffiti_settings")
      .upsert(JOB_SETTING_KEYS.map((k) => ({ k: settingKey(type, k), v: next[k] })), { onConflict: "k" });
    if (error) return fail(error.message, 500);
    return NextResponse.json({ settings: next });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not save settings.", 500);
  }
}
