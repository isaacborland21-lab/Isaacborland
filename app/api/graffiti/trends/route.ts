import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isCity, isType } from "@/lib/graffiti";
import { fail, fetchAll, isResponse, loadSettings, requireInvoice } from "@/lib/graffitiServer";
import { TrendRow, computeTrends, lastDaysRange } from "@/lib/graffitiTrends";
import { localNoonIso } from "@/lib/graffitiImport";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Owner, or a crew account with the graffiti tab and the invoice switch (the "Manager" role). Read-only.
// The trends of the tags found: how many, where, what kind, what keeps coming back.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (or last=N days)&city=all|bozeman|helena&type=all|<tag type>
const COLS = "id, lat, lng, city, address, gtype, gtype_other, surface, chemical, reported_at, removed_at, duration_min, status, urgent, removed_by_name, claimed_by_name, reported_by_name";
type Raw = Omit<TrendRow, "who"> & { removed_by_name: string | null; claimed_by_name: string | null; reported_by_name: string | null };

type Hist = { id: number; city: string; day: string; address: string | null; gtype: string; gtype_other: string | null; surface: string | null; chemical: string | null; duration_min: number | null; lat: number | null; lng: number | null };
const HIST_COLS = "id, city, day, address, gtype, gtype_other, surface, chemical, duration_min, lat, lng";
const HISTORY_CREW = "Old invoices (crew not recorded)";

const ymd = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function GET(request: Request) {
  const who = await requireInvoice();
  if (isResponse(who)) return who;
  const url = new URL(request.url);
  const cityParam = url.searchParams.get("city") ?? "all";
  const typeParam = url.searchParams.get("type") ?? "all";
  if (cityParam !== "all" && !isCity(cityParam)) return fail("Bad city.", 400);
  if (typeParam !== "all" && !isType(typeParam)) return fail("Bad tag type.", 400);
  let from = ymd(url.searchParams.get("from"));
  let to = ymd(url.searchParams.get("to"));
  if ((url.searchParams.get("from") && !from) || (url.searchParams.get("to") && !to)) return fail("Bad date.", 400);
  const lastRaw = url.searchParams.get("last");
  const last = lastRaw === null ? null : Number(lastRaw);
  if (last !== null && !(Number.isInteger(last) && last >= 1 && last <= 3650)) return fail("Bad range.", 400);

  const db = getSupabaseAdmin();
  try {
    const [settings, raw, history] = await Promise.all([
      loadSettings(db),
      fetchAll<Raw>((a, b) =>
        db.from("graffiti_incidents").select(COLS).is("deleted_at", null).order("id", { ascending: true }).range(a, b) as unknown as PromiseLike<{
          data: Raw[] | null;
          error: { message: string } | null;
        }>,
      ),
      // Imported old invoices. If that table is not set up yet, the page still works with the live tags alone.
      fetchAll<Hist>((a, b) =>
        db.from("graffiti_history").select(HIST_COLS).order("id", { ascending: true }).range(a, b) as unknown as PromiseLike<{
          data: Hist[] | null;
          error: { message: string } | null;
        }>,
      ).catch(() => [] as Hist[]),
    ]);
    const rows: TrendRow[] = raw.map((r) => {
      const { removed_by_name, claimed_by_name, reported_by_name, ...rest } = r;
      return { ...rest, who: removed_by_name || claimed_by_name || reported_by_name || null };
    });
    // an old invoice only has a day (not a time), so it is placed at noon that day, in the company time zone
    const noon = new Map<string, string>();
    for (const h of history) {
      let at = noon.get(h.day);
      if (!at) {
        at = localNoonIso(h.day, settings.tz);
        noon.set(h.day, at);
      }
      rows.push({
        id: -h.id,
        lat: h.lat,
        lng: h.lng,
        city: h.city,
        address: h.address,
        gtype: h.gtype,
        gtype_other: h.gtype_other,
        surface: h.surface,
        chemical: h.chemical,
        reported_at: at,
        removed_at: new Date(Date.parse(at) + (h.duration_min ?? 0) * 60000).toISOString(),
        duration_min: h.duration_min,
        status: "removed",
        urgent: false,
        who: HISTORY_CREW,
        src: "history",
      });
    }
    const nowMs = Date.now();
    if (last !== null) ({ from, to } = lastDaysRange(nowMs, settings.tz, last));
    const trends = computeTrends(rows, { from, to, city: cityParam === "all" ? "all" : (cityParam as "bozeman" | "helena"), type: typeParam, tz: settings.tz, nowMs });
    return NextResponse.json({ generated: new Date(nowMs).toISOString(), tz: settings.tz, canImport: who.owner, trends }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not load the trends.", 500);
  }
}
