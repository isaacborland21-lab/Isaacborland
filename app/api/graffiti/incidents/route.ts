import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeCreate } from "@/lib/graffiti";
import {
  checkPhoto,
  fail,
  INCIDENT_COLS,
  isResponse,
  readInput,
  removePhotos,
  requireGraffiti,
  toIncident,
  uploadPhoto,
} from "@/lib/graffitiServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// stays under Supabase's 1000-rows-per-request cap so "one extra row" can still signal truncation
const LIST_LIMIT = 900;

// Everything the tracker's list + map need. Newest first.
export async function GET() {
  const who = await requireGraffiti();
  if (isResponse(who)) return who;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("graffiti_incidents")
    .select(INCIDENT_COLS)
    .order("reported_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIST_LIMIT + 1);
  if (error) return fail(error.message, 500);

  const rows = data ?? [];
  const truncated = rows.length > LIST_LIMIT;
  return NextResponse.json(
    { incidents: rows.slice(0, LIST_LIMIT).map((r: unknown) => toIncident(r as Record<string, unknown>, who.userId)), truncated },
    { headers: { "Cache-Control": "no-store, must-revalidate" } },
  );
}

// Log a new incident. multipart/form-data (fields + optional `photo`) or JSON.
// A photo here is the BEFORE photo (mode=start also starts the clock at the moment it was taken),
// or, for mode=report, the REPORT photo: what the tag looked like when somebody spotted it.
export async function POST(request: Request) {
  const who = await requireGraffiti();
  if (isResponse(who)) return who;

  const input = await readInput(request);
  if (isResponse(input)) return input;

  const made = computeCreate(input.fields, Date.now());
  if (!made.ok) return fail(made.error, 400);

  const db = getSupabaseAdmin();
  let photoName: string | null = null;
  if (input.photo) {
    const checked = await checkPhoto(input.photo);
    if (!checked.ok) return fail(checked.error, 400);
    const up = await uploadPhoto(db, checked.bytes);
    if (!up.ok) return fail(up.error, 500);
    photoName = up.name;
  }

  const { data, error } = await db
    .from("graffiti_incidents")
    .insert({
      ...made.row,
      ...(input.fields.mode === "report" || (input.fields.mode !== "start" && input.fields.mode !== "done")
        ? { report_photo: photoName }
        : { before_photo: photoName }),
      reported_by_name: who.name,
      // starting a job yourself means you have taken it
      ...(made.row.status === "in_progress" ? { claimed_by: who.userId, claimed_by_name: who.name } : {}),
      // logged as already finished: the person logging it did it
      ...(made.row.status === "removed" ? { removed_by_name: who.name } : {}),
      created_by: who.userId,
    })
    .select(INCIDENT_COLS)
    .single();
  if (error || !data) {
    await removePhotos(db, [photoName]);
    return fail(error?.message ?? "Could not save the incident.", 500);
  }
  return NextResponse.json({ incident: toIncident(data as unknown as Record<string, unknown>, who.userId) }, { status: 201 });
}
