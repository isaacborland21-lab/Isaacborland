import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cityOf, isCity, localDate } from "@/lib/graffiti";
import { fail, fetchAll, isResponse, loadSettings, requireGraffiti } from "@/lib/graffitiServer";
import { ParsedRow, dedupeKeys, normAddr, parseSheets } from "@/lib/graffitiImport";
import { readSheets } from "@/lib/xlsxRead";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type Pending = ParsedRow & { key: string; dupe: boolean; overlap: boolean; geo: "none" | "found" };
type Known = { address: string | null; lat: number; lng: number };
type DayRow = { reported_at: string; city: string | null; lat: number; lng: number };

// Owner only. POST multipart: files[] (.xlsx / .csv old invoices) + city.
// Reads the files and shows what WOULD be imported. Nothing is saved here.
export async function POST(request: Request) {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Could not read the upload.", 400);
  }
  const city = form.get("city");
  if (!isCity(city)) return fail("Choose Bozeman or Helena.", 400);
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (files.length === 0) return fail("Choose at least one invoice file (.xlsx or .csv).", 400);
  if (files.length > 12) return fail("Up to 12 files at a time.", 400);

  const db = getSupabaseAdmin();
  try {
    const tz = (await loadSettings(db)).tz;
    const today = localDate(new Date().toISOString(), tz);
    const notes: string[] = [];
    const skipped: { file: string; line: number; why: string }[] = [];
    const parsed: ParsedRow[] = [];
    for (const f of files) {
      try {
        const sheets = await readSheets(new Uint8Array(await f.arrayBuffer()));
        const p = parseSheets(f.name, sheets, today);
        parsed.push(...p.rows);
        skipped.push(...p.skipped);
        for (const n of p.notes) notes.push(`${f.name}: ${n}`);
      } catch (e) {
        notes.push(`${f.name}: ${e instanceof Error ? e.message : "could not be read."}`);
      }
    }
    if (parsed.length === 0) return NextResponse.json({ city, rows: [], skipped, notes, counts: { read: 0, fresh: 0, dupes: 0, overlap: 0 } });

    const keys = dedupeKeys(city, parsed);
    const days = parsed.map((r) => r.day).sort();
    const [have, known, live] = await Promise.all([
      fetchAll<{ dedupe_key: string }>((a, b) =>
        db.from("graffiti_history").select("dedupe_key").eq("city", city).gte("day", days[0]).lte("day", days[days.length - 1]).order("id").range(a, b) as unknown as PromiseLike<{
          data: { dedupe_key: string }[] | null;
          error: { message: string } | null;
        }>,
      ),
      fetchAll<Known>((a, b) =>
        db.from("graffiti_history").select("address, lat, lng").eq("city", city).not("lat", "is", null).order("id").range(a, b) as unknown as PromiseLike<{
          data: Known[] | null;
          error: { message: string } | null;
        }>,
      ),
      fetchAll<DayRow>((a, b) =>
        db.from("graffiti_incidents").select("reported_at, city, lat, lng").order("id").range(a, b) as unknown as PromiseLike<{
          data: DayRow[] | null;
          error: { message: string } | null;
        }>,
      ),
    ]);
    const haveKeys = new Set(have.map((h) => h.dedupe_key));
    const knownAt = new Map<string, { lat: number; lng: number }>();
    for (const k of known) if (k.address) knownAt.set(normAddr(k.address), { lat: k.lat, lng: k.lng });
    // days the live tracker already has tags for (in this city): those invoice rows are probably the same tags
    const liveDays = new Set(live.filter((r) => cityOf(r) === city).map((r) => localDate(r.reported_at, tz)));

    const rows: Pending[] = parsed.map((r, i) => {
      const at = r.address ? knownAt.get(normAddr(r.address)) : undefined;
      return { ...r, key: keys[i], dupe: haveKeys.has(keys[i]), overlap: liveDays.has(r.day), lat: at?.lat ?? null, lng: at?.lng ?? null, geo: at ? "found" : "none" };
    });
    const counts = {
      read: rows.length,
      dupes: rows.filter((r) => r.dupe).length,
      overlap: rows.filter((r) => !r.dupe && r.overlap).length,
      fresh: rows.filter((r) => !r.dupe && !r.overlap).length,
    };
    return NextResponse.json({ city, rows, skipped, notes, counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not read the files.", 500);
  }
}
