import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { autoCity, isDate, localDate } from "@/lib/graffiti";
import { fail, fetchAll, isResponse, loadSettings, requireGraffiti } from "@/lib/graffitiServer";
import { PatrolPoint, cellCity, cellsVisited, cleanPoint, crewColor, toLines } from "@/lib/patrol";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// Patrol tracking. Only recorded while a crew member has "Patrolling" switched on (see PatrolBar).
// POST { session, points: [{ lat, lng, acc, at }] }   -> save a batch from a phone, and mark the grid cells it drove through
// GET  ?day=YYYY-MM-DD (default today)                -> everyone's routes that day, for the crew map
const MAX_POINTS = 600;

type Row = { user_name: string | null; user_id: string; session: string; lat: number; lng: number; at: string };

export async function POST(request: Request) {
  const who = await requireGraffiti();
  if (isResponse(who)) return who;
  let body: Record<string, unknown>;
  try {
    const b = await request.json();
    if (b === null || typeof b !== "object" || Array.isArray(b)) return fail("Invalid body.", 400);
    body = b as Record<string, unknown>;
  } catch {
    return fail("Invalid JSON body.", 400);
  }
  const session = typeof body.session === "string" ? body.session.trim() : "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(session)) return fail("Bad session.", 400);
  if (!Array.isArray(body.points)) return fail("No points.", 400);
  if (body.points.length > MAX_POINTS) return fail(`Send at most ${MAX_POINTS} points at a time.`, 400);
  const now = Date.now();
  const points = body.points.map((p) => cleanPoint(p, now)).filter((p): p is PatrolPoint => p !== null);
  if (points.length === 0) return NextResponse.json({ saved: 0 });

  const db = getSupabaseAdmin();
  try {
    const first = points.reduce((a, b) => (a.at < b.at ? a : b));
    // the point just before this batch (same patrol), so the line joins up across uploads
    const { data: prevRows } = await db
      .from("patrol_points")
      .select("lat, lng, at")
      .eq("session", session)
      .eq("user_id", who.userId)
      .lt("at", first.at)
      .order("at", { ascending: false })
      .limit(1);
    const prev = ((prevRows ?? []) as { lat: number; lng: number; at: string }[]).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), at: new Date(p.at).toISOString() }));

    const { error } = await db
      .from("patrol_points")
      .insert(points.map((p) => ({ user_id: who.userId, user_name: who.name, session, lat: p.lat, lng: p.lng, acc: p.acc ?? null, at: p.at })));
    if (error) return fail(error.message, 500);

    // last-visit time per grid cell: keep whichever is newer
    const visited = cellsVisited([...prev, ...points]);
    const keys = [...visited.keys()];
    if (keys.length > 0) {
      const { data: have, error: e2 } = await db.from("coverage_cells").select("cell, last_at").in("cell", keys);
      if (e2) return fail(e2.message, 500);
      const old = new Map(((have ?? []) as { cell: string; last_at: string }[]).map((r) => [r.cell, Date.parse(r.last_at)]));
      const rows = keys
        .filter((k) => !(old.get(k)! >= Date.parse(visited.get(k)!)))
        .map((k) => ({ cell: k, city: cellCity(k), last_at: visited.get(k)!, last_by: who.name }));
      if (rows.length > 0) {
        const { error: e3 } = await db.from("coverage_cells").upsert(rows, { onConflict: "cell" });
        if (e3) return fail(e3.message, 500);
      }
    }
    return NextResponse.json({ saved: points.length });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not save the patrol.", 500);
  }
}

export async function GET(request: Request) {
  const who = await requireGraffiti();
  if (isResponse(who)) return who;
  const url = new URL(request.url);
  const db = getSupabaseAdmin();
  try {
    const { tz } = await loadSettings(db);
    const today = localDate(new Date().toISOString(), tz);
    const dayParam = url.searchParams.get("day");
    if (dayParam !== null && !isDate(dayParam)) return fail("Bad day.", 400);
    const day = dayParam ?? today;
    // a generous UTC window around the local day, then filter by the local date
    const start = new Date(Date.parse(`${day}T00:00:00Z`) - 36 * 3_600_000).toISOString();
    const end = new Date(Date.parse(`${day}T00:00:00Z`) + 60 * 3_600_000).toISOString();
    const rows = await fetchAll<Row>((a, b) =>
      db
        .from("patrol_points")
        .select("user_name, user_id, session, lat, lng, at")
        .gte("at", start)
        .lt("at", end)
        .order("at", { ascending: true })
        .order("id", { ascending: true })
        .range(a, b) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
    );
    const city = url.searchParams.get("city");
    const byPerson = new Map<string, { name: string; sessions: Map<string, PatrolPoint[]>; last: string }>();
    for (const r of rows) {
      const at = new Date(r.at).toISOString();
      if (localDate(at, tz) !== day) continue;
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      if (city && autoCity(lat, lng) !== city) continue;
      const name = (r.user_name ?? "").trim() || "Crew";
      let p = byPerson.get(r.user_id);
      if (!p) byPerson.set(r.user_id, (p = { name, sessions: new Map(), last: at }));
      const s = p.sessions.get(r.session) ?? [];
      s.push({ lat, lng, at });
      p.sessions.set(r.session, s);
      if (at > p.last) p.last = at;
    }
    const now = Date.now();
    const crews = [...byPerson.values()]
      .map((p) => ({
        name: p.name,
        color: crewColor(p.name),
        lines: [...p.sessions.values()].flatMap((pts) => toLines(pts)),
        last: p.last,
        // a point in the last 5 minutes: patrolling right now
        live: day === today && now - Date.parse(p.last) < 5 * 60_000,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ day, crews }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not load the routes.", 500);
  }
}
