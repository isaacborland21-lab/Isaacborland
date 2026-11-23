import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isCity, localDate } from "@/lib/graffiti";
import { fail, fetchAll, isResponse, loadSettings, requireGraffiti } from "@/lib/graffitiServer";
import { CleanRow, MAX_ROWS, cleanRow, dedupeKeys } from "@/lib/graffitiImport";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Meta = { batch_id: string; source_file: string | null; city: string; day: string; created_at: string; lat: number | null };

// Owner only. The past imports, newest first (one line per import).
export async function GET() {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;
  const db = getSupabaseAdmin();
  try {
    const rows = await fetchAll<Meta>((a, b) =>
      db.from("graffiti_history").select("batch_id, source_file, city, day, created_at, lat").order("id", { ascending: true }).range(a, b) as unknown as PromiseLike<{
        data: Meta[] | null;
        error: { message: string } | null;
      }>,
    );
    const by = new Map<string, { batch: string; file: string | null; city: string; n: number; placed: number; from: string; to: string; at: string }>();
    for (const r of rows) {
      const e = by.get(r.batch_id) ?? { batch: r.batch_id, file: r.source_file, city: r.city, n: 0, placed: 0, from: r.day, to: r.day, at: r.created_at };
      e.n += 1;
      if (r.lat !== null) e.placed += 1;
      if (r.day < e.from) e.from = r.day;
      if (r.day > e.to) e.to = r.day;
      by.set(r.batch_id, e);
    }
    const batches = [...by.values()].sort((a, b) => b.at.localeCompare(a.at));
    return NextResponse.json({ batches, total: rows.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not load the imports.", 500);
  }
}

// Owner only. Save the rows the owner ticked. JSON: { city, source, rows: [...] }.
// Every row is checked again here (the browser is not trusted); a row already saved is skipped, not doubled.
export async function POST(request: Request) {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;
  let body: { city?: unknown; source?: unknown; rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Bad request.", 400);
  }
  if (!isCity(body.city)) return fail("Choose Bozeman or Helena.", 400);
  const city = body.city;
  if (!Array.isArray(body.rows) || body.rows.length === 0) return fail("Nothing to import.", 400);
  if (body.rows.length > MAX_ROWS) return fail(`At most ${MAX_ROWS} rows at a time.`, 400);
  const source = typeof body.source === "string" ? body.source.slice(0, 200) : null;

  const db = getSupabaseAdmin();
  try {
    const tz = (await loadSettings(db)).tz;
    const today = localDate(new Date().toISOString(), tz);
    const good: CleanRow[] = [];
    let bad = 0;
    for (const raw of body.rows) {
      const c = cleanRow(raw, city, today);
      if (c.ok) good.push(c.row);
      else bad += 1;
    }
    if (good.length === 0) return fail("None of those rows could be used.", 400);

    const keys = dedupeKeys(city, good);
    const batch = crypto.randomUUID();
    let inserted = 0;
    for (let i = 0; i < good.length; i += 400) {
      const chunk = good.slice(i, i + 400).map((r, j) => ({
        batch_id: batch,
        source_file: source,
        city,
        day: r.day,
        address: r.address || null,
        gtype: r.gtype,
        gtype_other: r.gtype_other,
        surface: r.surface,
        chemical: r.chemical,
        notes: r.notes,
        duration_min: r.duration_min,
        lat: r.lat,
        lng: r.lng,
        geo: r.geo,
        dedupe_key: keys[i + j],
        created_by: who.userId,
      }));
      const { data, error } = await db.from("graffiti_history").upsert(chunk, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
      if (error) return fail(error.message, 500);
      inserted += data?.length ?? 0;
    }
    return NextResponse.json({ batch, inserted, already: good.length - inserted, rejected: bad }, { status: 201 });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not save the import.", 500);
  }
}

// Owner only. Undo one whole import: DELETE ?batch=<id>.
export async function DELETE(request: Request) {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;
  const batch = new URL(request.url).searchParams.get("batch") ?? "";
  if (!UUID.test(batch)) return fail("Bad import id.", 400);
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("graffiti_history").delete().eq("batch_id", batch).select("id");
  if (error) return fail(error.message, 500);
  return NextResponse.json({ removed: data?.length ?? 0 });
}
