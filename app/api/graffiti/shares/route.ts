import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { clean, isCity } from "@/lib/graffiti";
import { fail, isResponse, requireGraffiti } from "@/lib/graffitiServer";
import { SHARE_PREFIX, ShareLink, isShareToken, parseShare } from "@/lib/clientMap";

export const dynamic = "force-dynamic";

// Owner only: the private links for live client maps.
// GET                         -> every link
// POST { city, label }        -> a new link
// DELETE { token }            -> turn a link off (the old URL stops working at once)
async function list(): Promise<ShareLink[] | NextResponse> {
  const { data, error } = await getSupabaseAdmin().from("graffiti_settings").select("k, v").like("k", `${SHARE_PREFIX}%`);
  if (error) return fail(error.message, 500);
  return ((data ?? []) as { k: string; v: string | null }[])
    .map((r) => parseShare(r.k, r.v))
    .filter((x): x is ShareLink => x !== null)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function GET() {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;
  const links = await list();
  if (isResponse(links)) return links;
  return NextResponse.json({ links }, { headers: { "Cache-Control": "no-store" } });
}

async function body(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    const b = await request.json();
    if (b === null || typeof b !== "object" || Array.isArray(b)) return fail("Invalid body.", 400);
    return b as Record<string, unknown>;
  } catch {
    return fail("Invalid JSON body.", 400);
  }
}

export async function POST(request: Request) {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;
  const b = await body(request);
  if (isResponse(b)) return b;
  if (!isCity(b.city)) return fail("Choose Bozeman or Helena.", 400);
  const label = clean(typeof b.label === "string" ? b.label : "", 80) ?? "";
  const token = randomBytes(24).toString("base64url");
  const link: ShareLink = { token, city: b.city, label, created_at: new Date().toISOString() };
  const { error } = await getSupabaseAdmin()
    .from("graffiti_settings")
    .insert({ k: SHARE_PREFIX + token, v: JSON.stringify({ city: link.city, label: link.label, created_at: link.created_at }) });
  if (error) return fail(error.message, 500);
  return NextResponse.json({ link }, { status: 201 });
}

export async function DELETE(request: Request) {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;
  const b = await body(request);
  if (isResponse(b)) return b;
  if (!isShareToken(b.token)) return fail("Bad link.", 400);
  const { error } = await getSupabaseAdmin().from("graffiti_settings").delete().eq("k", SHARE_PREFIX + b.token);
  if (error) return fail(error.message, 500);
  return NextResponse.json({ ok: true });
}
