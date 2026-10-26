import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeJobCreate, isJobType } from "@/lib/jobs";
import { checkPhoto, fail, isResponse, readInput, removePhotos, uploadPhoto } from "@/lib/graffitiServer";
import { JOB_COLS, requireJobs, toJob } from "@/lib/jobsServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// stays under Supabase's 1000-rows-per-request cap so "one extra row" can still signal truncation
const LIST_LIMIT = 900;

type Ctx = { params: { type: string } };

// Everything one job tab's list needs. Newest first.
export async function GET(_request: Request, { params }: Ctx) {
  if (!isJobType(params.type)) return fail("Unknown job type.", 404);
  const who = await requireJobs(params.type);
  if (isResponse(who)) return who;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("jobs")
    .select(JOB_COLS)
    .eq("jtype", params.type)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIST_LIMIT + 1);
  if (error) return fail(error.message, 500);

  const rows = data ?? [];
  return NextResponse.json(
    {
      jobs: rows.slice(0, LIST_LIMIT).map((r: unknown) => toJob(r as Record<string, unknown>, who)),
      truncated: rows.length > LIST_LIMIT,
      canBill: who.canBill,
    },
    { headers: { "Cache-Control": "no-store, must-revalidate" } },
  );
}

// Log a new job. multipart/form-data (fields + optional `photo`) or JSON.
// A photo here is the BEFORE photo (mode=start also starts the clock at the moment it was taken).
export async function POST(request: Request, { params }: Ctx) {
  if (!isJobType(params.type)) return fail("Unknown job type.", 404);
  const who = await requireJobs(params.type);
  if (isResponse(who)) return who;

  const input = await readInput(request);
  if (isResponse(input)) return input;

  const made = computeJobCreate(input.fields, Date.now(), who.canBill);
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
    .from("jobs")
    .insert({
      ...made.row,
      jtype: params.type,
      before_photo: photoName,
      created_by: who.userId,
      created_by_name: who.name,
      // logged as already finished: the person logging it did it
      ...(made.row.status === "done" ? { done_by_name: who.name } : {}),
    })
    .select(JOB_COLS)
    .single();
  if (error || !data) {
    await removePhotos(db, [photoName]);
    return fail(error?.message ?? "Could not save the job.", 500);
  }
  return NextResponse.json({ job: toJob(data as unknown as Record<string, unknown>, who) }, { status: 201 });
}
