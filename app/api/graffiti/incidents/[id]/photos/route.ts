import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { MAX_EXTRA_PHOTOS } from "@/lib/graffiti";
import { checkPhoto, fail, isResponse, loadPhotos, readInput, removePhotos, requireGraffiti, uploadPhoto } from "@/lib/graffitiServer";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };
const parseId = (s: string) => (/^\d{1,15}$/.test(s) && Number(s) > 0 ? Number(s) : null);

// Add one more photo to a tag, any time and in any status (also after it is finished or invoiced:
// extra photos never change the time, the status or the bill). The phone sends photos one at a time.
export async function POST(request: Request, { params }: Ctx) {
  const who = await requireGraffiti();
  if (isResponse(who)) return who;
  const id = parseId(params.id);
  if (id === null) return fail("Bad id.", 400);

  const input = await readInput(request);
  if (isResponse(input)) return input;
  if (!input.photo) return fail("Choose a photo to add.", 400);

  const db = getSupabaseAdmin();
  const { data: row, error: readErr } = await db.from("graffiti_incidents").select("id").eq("id", id).maybeSingle();
  if (readErr) return fail(readErr.message, 500);
  if (!row) return fail("Incident not found.", 404);

  const { data: have, error: countErr } = await db.from("graffiti_photos").select("id").eq("incident_id", id);
  if (countErr) return fail(countErr.message, 500);
  if ((have ?? []).length >= MAX_EXTRA_PHOTOS) return fail(`This tag already has ${MAX_EXTRA_PHOTOS} extra photos (the most it can hold).`, 409);

  const checked = await checkPhoto(input.photo);
  if (!checked.ok) return fail(checked.error, 400);
  const up = await uploadPhoto(db, checked.bytes);
  if (!up.ok) return fail(up.error, 500);

  const { error } = await db.from("graffiti_photos").insert({ incident_id: id, name: up.name, added_by: who.userId, added_by_name: who.name });
  if (error) {
    await removePhotos(db, [up.name]);
    return fail(error.message, 500);
  }

  try {
    const photos = (await loadPhotos(db, [id], who.userId)).get(id) ?? [];
    return NextResponse.json({ photos }, { status: 201 });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The photo was added but the list could not be loaded. Reload the page.", 500);
  }
}
