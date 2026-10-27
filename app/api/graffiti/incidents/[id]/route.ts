import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeUpdate, CurrentIncident } from "@/lib/graffiti";
import {
  checkPhoto,
  fail,
  INCIDENT_COLS,
  isResponse,
  loadInvoices,
  loadPhotos,
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
  const current = row as unknown as CurrentIncident & {
    before_photo: string | null;
    after_photo: string | null;
    report_photo: string | null;
    claimed_by: string | null;
    claimed_by_name: string | null;
  };

  let kind: "before" | "after" | "report" | null = null;
  if (photo) {
    kind =
      fields.act === "start"
        ? "before"
        : fields.act === "finish"
          ? "after"
          : fields.photo_kind === "before" || fields.photo_kind === "after" || fields.photo_kind === "report"
            ? fields.photo_kind
            : null;
    if (!kind) return fail("Say whether the photo is the report, before or after photo.", 400);
  }

  const result = computeUpdate(current, fields, Date.now(), photo !== null);
  if (!result.ok) return fail(result.error, 400);

  const { claim, ...columns } = result.patch;
  const update: Record<string, unknown> = { ...columns, updated_at: new Date().toISOString() };
  if (claim === "me") {
    update.claimed_by = who.userId;
    update.claimed_by_name = who.name;
  } else if (claim === "release") {
    // only whoever took it (or the owner) can give it back
    if (current.claimed_by && current.claimed_by !== who.userId && !who.owner) return fail("Someone else took this one.", 403);
    update.claimed_by = null;
    update.claimed_by_name = null;
  } else if (fields.act === "start") {
    // starting the job yourself means you have taken it (even if someone else had said they would)
    update.claimed_by = who.userId;
    update.claimed_by_name = who.name;
  }
  // who gets the credit on the invoice: whoever took the job, else whoever finished it
  if (columns.status === "removed" && current.status !== "removed") {
    update.removed_by_name = (update.claimed_by_name as string | null | undefined) ?? current.claimed_by_name ?? who.name;
  } else if (columns.status !== undefined && columns.status !== "removed") {
    update.removed_by_name = null;
  }
  let newName: string | null = null;
  let oldName: string | null = null;
  if (photo && kind) {
    const checked = await checkPhoto(photo);
    if (!checked.ok) return fail(checked.error, 400);
    const up = await uploadPhoto(db, checked.bytes);
    if (!up.ok) return fail(up.error, 500);
    newName = up.name;
    oldName = kind === "before" ? current.before_photo : kind === "after" ? current.after_photo : current.report_photo;
    update[kind === "before" ? "before_photo" : kind === "after" ? "after_photo" : "report_photo"] = newName;
  }

  const { data, error } = await db.from("graffiti_incidents").update(update).eq("id", id).select(INCIDENT_COLS).single();
  if (error || !data) {
    await removePhotos(db, [newName]);
    return fail(error?.message ?? "Could not save the change.", 500);
  }
  await removePhotos(db, [oldName]);
  let photos: Awaited<ReturnType<typeof loadPhotos>>;
  try {
    photos = await loadPhotos(db, [id], who.userId);
  } catch {
    photos = new Map(); // the change is saved; the next refresh shows the extra photos again
  }
  return NextResponse.json({ incident: toIncident(data as unknown as Record<string, unknown>, who.userId, photos.get(id) ?? []) });
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
    .select("id, created_by, before_photo, after_photo, report_photo")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return fail(readErr.message, 500);
  if (!row) return fail("Incident not found.", 404);
  const r = row as unknown as { created_by: string; before_photo: string | null; after_photo: string | null; report_photo: string | null };

  if (!who.owner && r.created_by !== who.userId) return fail("Only the person who logged this (or the owner) can delete it.", 403);

  const invoices = await loadInvoices(db);
  const sent = invoices.find((i) => i.job_ids.includes(id));
  if (sent) return fail(`This tag is on invoice ${sent.invoice_no} (${sent.month}), which was marked as sent. Undo that invoice first.`, 409);

  // the extra photos' rows go with the tag (cascade); their files are removed below
  const { data: extra } = await db.from("graffiti_photos").select("name").eq("incident_id", id);
  const { error } = await db.from("graffiti_incidents").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  await removePhotos(db, [r.before_photo, r.after_photo, r.report_photo, ...((extra ?? []) as { name: string }[]).map((p) => p.name)]);
  return NextResponse.json({ ok: true });
}
