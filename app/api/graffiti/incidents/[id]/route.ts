import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeUpdate, CurrentIncident } from "@/lib/graffiti";
import {
  checkPhoto,
  fail,
  INCIDENT_COLS,
  isResponse,
  loadInvoices,
  readInput,
  removePhotos,
  requireGraffiti,
  toIncident,
  uploadPhoto,
} from "@/lib/graffitiServer";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };
const parseId = (s: string) => (/^\d{1,15}$/.test(s) && Number(s) > 0 ? Number(s) : null);

// Update fields, move the job along (act=start with the before photo, act=finish with the after photo),
// or fix its time / location / tag type afterwards.
export async function PATCH(request: Request, { params }: Ctx) {
  const who = await requireGraffiti();
  if (isResponse(who)) return who;
  const id = parseId(params.id);
  if (id === null) return fail("Bad id.", 400);

  const input = await readInput(request);
  if (isResponse(input)) return input;
  const { fields, photo } = input;

  const db = getSupabaseAdmin();
  const { data: row, error: readErr } = await db.from("graffiti_incidents").select(INCIDENT_COLS).eq("id", id).maybeSingle();
  if (readErr) return fail(readErr.message, 500);
  if (!row) return fail("Incident not found.", 404);
  const current = row as unknown as CurrentIncident & { before_photo: string | null; after_photo: string | null };

  let kind: "before" | "after" | null = null;
  if (photo) {
    kind = fields.act === "start" ? "before" : fields.act === "finish" ? "after" : fields.photo_kind === "before" || fields.photo_kind === "after" ? fields.photo_kind : null;
    if (!kind) return fail("Say whether the photo is the before or after photo.", 400);
  }

  const result = computeUpdate(current, fields, Date.now(), photo !== null);
  if (!result.ok) return fail(result.error, 400);

  const update: Record<string, unknown> = { ...result.patch, updated_at: new Date().toISOString() };
  let newName: string | null = null;
  let oldName: string | null = null;
  if (photo && kind) {
    const checked = await checkPhoto(photo);
    if (!checked.ok) return fail(checked.error, 400);
    const up = await uploadPhoto(db, checked.bytes);
    if (!up.ok) return fail(up.error, 500);
    newName = up.name;
    oldName = kind === "before" ? current.before_photo : current.after_photo;
    update[kind === "before" ? "before_photo" : "after_photo"] = newName;
  }

  const { data, error } = await db.from("graffiti_incidents").update(update).eq("id", id).select(INCIDENT_COLS).single();
  if (error || !data) {
    await removePhotos(db, [newName]);
    return fail(error?.message ?? "Could not save the change.", 500);
  }
  await removePhotos(db, [oldName]);
  return NextResponse.json({ incident: toIncident(data as unknown as Record<string, unknown>, who.userId) });
}

// Only whoever logged the incident, or the owner, may delete it — and never one that is on a sent invoice.
export async function DELETE(_request: Request, { params }: Ctx) {
  const who = await requireGraffiti();
  if (isResponse(who)) return who;
  const id = parseId(params.id);
  if (id === null) return fail("Bad id.", 400);

  const db = getSupabaseAdmin();
  const { data: row, error: readErr } = await db
    .from("graffiti_incidents")
    .select("id, created_by, before_photo, after_photo")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return fail(readErr.message, 500);
  if (!row) return fail("Incident not found.", 404);
  const r = row as unknown as { created_by: string; before_photo: string | null; after_photo: string | null };

  if (!who.owner && r.created_by !== who.userId) return fail("Only the person who logged this (or the owner) can delete it.", 403);

  const invoices = await loadInvoices(db);
  const sent = invoices.find((i) => i.job_ids.includes(id));
  if (sent) return fail(`This tag is on the ${sent.month} invoice that was marked as sent. Undo "invoiced" for that month first.`, 409);

  const { error } = await db.from("graffiti_incidents").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  await removePhotos(db, [r.before_photo, r.after_photo]);
  return NextResponse.json({ ok: true });
}
