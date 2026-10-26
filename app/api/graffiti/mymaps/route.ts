import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isCity } from "@/lib/graffiti";
import { fail, isResponse, loadFinished, loadSettings, requireInvoice } from "@/lib/graffitiServer";
import { MYMAPS_MAX_ROWS, MyMapsPick, availablePeriods, buildMyMapsCsv, isSeasonKey, isYear, pickTags, seasonLabel } from "@/lib/myMaps";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Finished graffiti tags as a CSV for Google My Maps (owner, or crew with the invoice switch: same people as the invoice page).
// GET /api/graffiti/mymaps?city=bozeman                         -> which seasons / years have tags (JSON)
// GET /api/graffiti/mymaps?city=bozeman&season=2026-3-fall       -> CSV for that season
// GET /api/graffiti/mymaps?city=helena&year=2026                 -> CSV for that calendar year
export async function GET(request: Request) {
  const who = await requireInvoice();
  if (isResponse(who)) return who;

  const url = new URL(request.url);
  const city = url.searchParams.get("city");
  if (!isCity(city)) return fail("Choose Bozeman or Helena.", 400);
  const season = url.searchParams.get("season");
  const year = url.searchParams.get("year");
  if (season !== null && !isSeasonKey(season)) return fail("Bad season.", 400);
  if (year !== null && !isYear(year)) return fail("Bad year.", 400);
  if (season !== null && year !== null) return fail("Pick a season or a year, not both.", 400);

  const db = getSupabaseAdmin();
  try {
    const [settings, rows] = await Promise.all([loadSettings(db), loadFinished(db)]);
    const tz = settings.tz;
    if (season === null && year === null) {
      return NextResponse.json(availablePeriods(rows, { city, tz }), { headers: { "Cache-Control": "no-store" } });
    }
    const pick: MyMapsPick = season !== null ? { kind: "season", key: season } : { kind: "year", year: year as string };
    const tags = pickTags(rows, { city, tz, pick });
    if (tags.length === 0) return fail("No finished tags in that period.", 404);
    if (tags.length > MYMAPS_MAX_ROWS) {
      return fail(`That's ${tags.length} tags, but My Maps takes at most ${MYMAPS_MAX_ROWS} per layer. Export by season instead.`, 400);
    }
    const name = (pick.kind === "season" ? seasonLabel(pick.key) : pick.year).replace(/\s+/g, "-");
    return new Response(buildMyMapsCsv(tags), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="graffiti-${city}-${name}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not build the export.", 500);
  }
}
