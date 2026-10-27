import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fail, isResponse, loadPhotos, removePhotos, requireGraffiti } from "@/lib/graffitiServer";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; photoId: string } };
const parseId = (s: string) => (/^\d{1,15}$/.test(s) && Number(s) > 0 ? Number(s) : null);

// Remove one extra photo. Only whoever added it, or the owner, may.
export async function DELETE(_request: Request, { params }: Ctx) {
  const who = await requireGraffiti();
  if (isResponse(who)) return who;
  const id = parseId(params.id);
  const photoId = parseId(params.photoId);
  if (id === null || photoId === null) return fail("Bad id.", 400);

  const db = getSupabaseAdmin();
  const { data: row, error: readErr } = await db.from("graffiti_photos").select("id, name, added_by").eq("id", photoId).eq("incident_id", id).maybeSingle();
  if (readErr) return fail(readErr.message, 500);
  if (!row) return fail("Photo not found.", 404);
  const r = row as unknown as { id: number; name: string; added_by: string };
  if (!who.owner && r.added_by !== who.userId) return fail("Only the person who added this photo (or the owner) can remove it.", 403);

  const { error } = await db.from("graffiti_photos").delete().eq("id", photoId).eq("incident_id", id);
  if (error) return fail(error.message, 500);
  await removePhotos(db, [r.name]);

  try {
    const photos = (await loadPhotos(db, [id], who.userId)).get(id) ?? [];
    return NextResponse.json({ photos });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The photo was removed but the list could not be loaded. Reload the page.", 500);
  }
}
