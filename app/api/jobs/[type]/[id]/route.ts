import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeJobUpdate, CurrentJob, isJobType } from "@/lib/jobs";
import { checkPhoto, fail, isResponse, readInput, removePhotos, uploadPhoto } from "@/lib/graffitiServer";
import { JOB_COLS, requireJobs, toJob } from "@/lib/jobsServer";

export const dynamic = "force-dynamic";

type Ctx = { params: { type: string; id: string } };
const parseId = (s: string) => (/^\d{1,15}$/.test(s) && Number(s) > 0 ? Number(s) : null);

// Update fields, move the job along (act=start with the before photo, act=finish with the after photo),
// or fix its time / title / location afterwards.
export async function PATCH(request: Request, { params }: Ctx) {
  if (!isJobType(params.type)) return fail("Unknown job type.", 404);
  const who = await requireJobs(params.type);
  if (isResponse(who)) return who;
  const id = parseId(params.id);
  if (id === null) return fail("Bad id.", 400);

  const input = await readInput(request);
  if (isResponse(input)) return input;
  const { fields, photo } = input;

  const db = getSupabaseAdmin();
  const { data: row, error: readErr } = await db.from("jobs").select(JOB_COLS).eq("id", id).eq("jtype", params.type).maybeSingle();
  if (readErr) return fail(readErr.message, 500);
  if (!row) return fail("Job not found.", 404);
  const current = row as unknown as CurrentJob & { before_photo: string | null; after_photo: string | null; done_by_name: string | null };

  let kind: "before" | "after" | null = null;
  if (photo) {
    kind =
      fields.act === "start"
        ? "before"
        : fields.act === "finish"
          ? "after"
          : fields.photo_kind === "before" || fields.photo_kind === "after"
            ? fields.photo_kind
            : null;
    if (!kind) return fail("Say whether the photo is the before or after photo.", 400);
  }

  const result = computeJobUpdate(current, fields, Date.now(), photo !== null, who.canBill);
  if (!result.ok) return fail(result.error, 400);

  const update: Record<string, unknown> = { ...result.patch, updated_at: new Date().toISOString() };
  // who gets the credit on the invoice: whoever finished it
  if (result.patch.status === "done" && current.status !== "done") update.done_by_name = who.name;
  else if (result.patch.status !== undefined && result.patch.status !== "done") update.done_by_name = null;

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

  const { data, error } = await db.from("jobs").update(update).eq("id", id).eq("jtype", params.type).select(JOB_COLS).single();
  if (error || !data) {
    await removePhotos(db, [newName]);
    return fail(error?.message ?? "Could not save the change.", 500);
  }
  await removePhotos(db, [oldName]);
  return NextResponse.json({ job: toJob(data as unknown as Record<string, unknown>, who) });
}

// Only whoever logged the job, or the owner, may delete it.
export async function DELETE(_request: Request, { params }: Ctx) {
  if (!isJobType(params.type)) return fail("Unknown job type.", 404);
  const who = await requireJobs(params.type);
  if (isResponse(who)) return who;
  const id = parseId(params.id);
  if (id === null) return fail("Bad id.", 400);

  const db = getSupabaseAdmin();
  const { data: row, error: readErr } = await db
    .from("jobs")
    .select("id, created_by, before_photo, after_photo")
    .eq("id", id)
    .eq("jtype", params.type)
    .maybeSingle();
  if (readErr) return fail(readErr.message, 500);
  if (!row) return fail("Job not found.", 404);
  const r = row as unknown as { created_by: string; before_photo: string | null; after_photo: string | null };

  if (!who.owner && r.created_by !== who.userId) return fail("Only the person who logged this (or the owner) can delete it.", 403);

  const { error } = await db.from("jobs").delete().eq("id", id).eq("jtype", params.type);
  if (error) return fail(error.message, 500);
  await removePhotos(db, [r.before_photo, r.after_photo]);
  return NextResponse.json({ ok: true });
}
