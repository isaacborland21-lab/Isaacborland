import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { CITY_NAMES } from "@/lib/graffiti";
import { fail, loadFinished, loadSettings } from "@/lib/graffitiServer";
import { SHARE_PREFIX, isShareToken, parseShare, publicTags, seasonsOf } from "@/lib/clientMap";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// PUBLIC (no sign-in): the data behind a live client map link. Anyone with the link can see it, so it only ever returns
// finished tags for that link's city: position, address, date and tag type. No crew names, notes, photos, times or prices.
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  // same answer for a malformed and an unknown/turned-off link, so links can't be probed
  if (!isShareToken(params.token)) return fail("This map link is not valid (it may have been turned off).", 404);
  const db = getSupabaseAdmin();
  try {
    const { data, error } = await db.from("graffiti_settings").select("k, v").eq("k", SHARE_PREFIX + params.token).maybeSingle();
    if (error) return fail("Could not load the map.", 500);
    const link = data ? parseShare((data as { k: string; v: string | null }).k, (data as { k: string; v: string | null }).v) : null;
    if (!link) return fail("This map link is not valid (it may have been turned off).", 404);

    const [settings, rows] = await Promise.all([loadSettings(db), loadFinished(db)]);
    const tags = publicTags(rows, { city: link.city, tz: settings.tz });
    return NextResponse.json(
      {
        title: link.label || `Graffiti removal: ${CITY_NAMES[link.city]}`,
        city: link.city,
        cityName: CITY_NAMES[link.city],
        by: settings.biz_name,
        updated: new Date().toISOString(),
        seasons: seasonsOf(tags),
        tags,
      },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
    );
  } catch {
    return fail("Could not load the map.", 500);
  }
}
