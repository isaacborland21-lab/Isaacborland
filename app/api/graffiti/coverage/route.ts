import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { City, cityOf, isCity } from "@/lib/graffiti";
import { fail, fetchAll, isResponse, loadSettings, requireGraffiti } from "@/lib/graffitiServer";
import { CoverageCell, KEEP_DAYS, cellKey, cellsInBox, priorities } from "@/lib/patrol";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Owner only. For one city: every ~300 m grid cell with the last time a crew covered it (drove through while
// patrolling, or logged a tag there), and how many tags it had in the last year. Plus the top places to check next.
// GET ?city=bozeman
type Tag = { lat: number; lng: number; city: string | null; address: string | null; reported_at: string | null; removed_at: string | null; reported_by_name: string | null; removed_by_name: string | null };

export async function GET(request: Request) {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;
  const url = new URL(request.url);
  const city = url.searchParams.get("city") ?? "bozeman";
  if (!isCity(city)) return fail("Bad city.", 400);
  const db = getSupabaseAdmin();
  try {
    // tracks older than KEEP_DAYS are deleted (the per-cell "last covered" dates stay)
    await db.from("patrol_points").delete().lt("at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString());

    const [, cellRows, tags] = await Promise.all([
      loadSettings(db),
      fetchAll<{ cell: string; last_at: string; last_by: string | null }>((a, b) =>
        db.from("coverage_cells").select("cell, last_at, last_by").eq("city", city).order("cell", { ascending: true }).range(a, b) as unknown as PromiseLike<{
          data: { cell: string; last_at: string; last_by: string | null }[] | null;
          error: { message: string } | null;
        }>,
      ),
      fetchAll<Tag>((a, b) =>
        db
          .from("graffiti_incidents")
          .select("lat, lng, city, address, reported_at, removed_at, reported_by_name, removed_by_name")
          .order("id", { ascending: true })
          .range(a, b) as unknown as PromiseLike<{ data: Tag[] | null; error: { message: string } | null }>,
      ),
    ]);

    const now = Date.now();
    const yearAgo = now - 365 * 86_400_000;
    const cells = new Map<string, CoverageCell & { place: string | null; placeAt: string }>();
    const get = (k: string) => {
      let c = cells.get(k);
      if (!c) cells.set(k, (c = { key: k, last: null, lastBy: null, tags: 0, place: null, placeAt: "" }));
      return c;
    };
    const seen = (c: CoverageCell, at: string | null, by: string | null) => {
      if (!at) return;
      const iso = new Date(at).toISOString();
      if (!c.last || iso > c.last) {
        c.last = iso;
        c.lastBy = by;
      }
    };
    for (const k of cellsInBox(city as City)) get(k);
    for (const r of cellRows) seen(get(r.cell), r.last_at, r.last_by);
    for (const t of tags) {
      const lat = Number(t.lat);
      const lng = Number(t.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || cityOf({ city: t.city, lat, lng }) !== city) continue;
      const c = get(cellKey(lat, lng));
      seen(c, t.reported_at, t.reported_by_name);
      seen(c, t.removed_at, t.removed_by_name ?? t.reported_by_name);
      const when = t.removed_at ?? t.reported_at;
      if (t.removed_at && Date.parse(t.removed_at) >= yearAgo) c.tags += 1;
      // a recognisable name for the cell: the most recent tag's address
      if (t.address && when && when > c.placeAt) {
        c.place = t.address;
        c.placeAt = when;
      }
    }
    const list: CoverageCell[] = [...cells.values()].map((c) => ({ key: c.key, last: c.last, lastBy: c.lastBy, tags: c.tags, place: c.place }));
    return NextResponse.json(
      { city, now: new Date(now).toISOString(), cells: list, top: priorities(list, now, 10) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not load coverage.", 500);
  }
}
