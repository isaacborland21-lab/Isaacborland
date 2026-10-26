import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { canInvoice, PublicMetadata } from "@/lib/supabaseAdmin";
import { canUseJobType, Job, JOB_TYPES, JobType, Material } from "@/lib/jobs";
import { Db, displayName, fail, fetchAll, isResponse, loadSettings } from "@/lib/graffitiServer";
import { BillingSettings, InvoiceSnapshot, isCity } from "@/lib/graffiti";
import { JobInvoiceRow, JobSettings, mergeJobSettings } from "@/lib/jobInvoice";

// Server-only helpers for the job API routes (work orders / lawn care / other jobs). Never import from a client component.
// Photos, names, JSON parsing and the fail() helper are shared with the graffiti tracker (lib/graffitiServer.ts).

export const JOB_COLS =
  "id, jtype, status, title, wo_number, city, address, lat, lng, description, notes, bill_mode, price_cents, materials, before_photo, after_photo, started_at, finished_at, done_at, duration_min, created_at, created_by, created_by_name, done_by_name";

export type JobWho = { userId: string; owner: boolean; name: string; /** may see and change prices (owner, or the invoice switch on this tab) */ canBill: boolean };

/** Signed in AND allowed on this job type (owner, granted the tab in the Admin tab, or any graffiti crew account). */
export async function requireJobs(type: JobType): Promise<JobWho | NextResponse> {
  const { userId } = auth();
  if (!userId) return fail("Not signed in.", 401);
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = user.publicMetadata as PublicMetadata;
  if (!canUseJobType(meta, type)) return fail("Not permitted to use this tab.", 403);
  return { userId, owner: meta.owner === true, name: displayName(user), canBill: canInvoice(meta, type) };
}

/** Signed in AND allowed on at least one of the job tabs (used for job photos, which are shared by the three tabs). */
export async function requireAnyJobTab(): Promise<JobWho | NextResponse> {
  const { userId } = auth();
  if (!userId) return fail("Not signed in.", 401);
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = user.publicMetadata as PublicMetadata;
  if (!JOB_TYPES.some((t) => canUseJobType(meta, t))) return fail("Not permitted.", 403);
  return { userId, owner: meta.owner === true, name: displayName(user), canBill: false };
}

function cleanMaterials(v: unknown): Material[] {
  if (!Array.isArray(v)) return [];
  const out: Material[] = [];
  for (const m of v) {
    if (m && typeof m === "object") {
      const o = m as { desc?: unknown; cents?: unknown };
      if (typeof o.desc === "string" && typeof o.cents === "number" && Number.isFinite(o.cents)) out.push({ desc: o.desc, cents: Math.round(o.cents) });
    }
  }
  return out;
}

/**
 * A database row -> what the browser gets. Prices are only sent to people who may see them
 * (crew without the invoice switch never receive price or materials amounts).
 */
export function toJob(row: Record<string, unknown>, who: Pick<JobWho, "userId" | "canBill">): Job {
  const { created_by, ...rest } = row as Record<string, unknown> & { created_by?: string };
  const job = { ...(rest as unknown as Job), mine: created_by === who.userId };
  job.materials = cleanMaterials((rest as { materials?: unknown }).materials);
  job.lat = job.lat === null || job.lat === undefined ? null : Number(job.lat);
  job.lng = job.lng === null || job.lng === undefined ? null : Number(job.lng);
  if (!who.canBill) {
    job.price_cents = null;
    job.materials = [];
  }
  return job;
}

// ---------- Invoicing ----------

export const JOB_SNAPSHOT_COLS =
  "id, jtype, city, month, invoice_no, invoice_date, invoiced_at, jobs, actual_min, billed_min, total_cents, rate_cents, min_minutes, round_to, job_ids, date_from, date_to";
const JOB_INVOICE_COLS =
  "id, title, wo_number, city, address, lat, lng, notes, description, bill_mode, price_cents, materials, before_photo, after_photo, started_at, finished_at, done_at, duration_min, done_by_name, created_by_name";

/** The owner, or a crew account with this job tab AND the invoice switch. Settings and "undo" stay owner-only (check who.owner). */
export async function requireJobInvoice(type: JobType): Promise<JobWho | NextResponse> {
  const who = await requireJobs(type);
  if (isResponse(who)) return who;
  if (!who.canBill) return fail("Not permitted to use the invoice.", 403);
  return who;
}

/** Shared business details (name, address, terms, time zone) plus this job type's own rate / minimum / Bill to / PO. */
export async function loadJobSettings(db: Db, type: JobType): Promise<{ shared: BillingSettings; job: JobSettings }> {
  const shared = await loadSettings(db);
  const { data, error } = await db.from("graffiti_settings").select("k, v").like("k", `${type}.%`);
  if (error) throw new Error(error.message);
  return { shared, job: mergeJobSettings((data ?? []) as { k: string; v: string | null }[], type) };
}

/** Finished jobs of one type, each with `done_by`: who finished it, else who logged it. */
export async function loadDoneJobs(db: Db, type: JobType): Promise<JobInvoiceRow[]> {
  type Raw = Omit<JobInvoiceRow, "done_by"> & { done_by_name: string | null; created_by_name: string | null };
  const raw = await fetchAll<Raw>((a, b) =>
    db
      .from("jobs")
      .select(JOB_INVOICE_COLS)
      .eq("jtype", type)
      .not("done_at", "is", null)
      .order("done_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b) as unknown as PromiseLike<{ data: Raw[] | null; error: { message: string } | null }>,
  );
  return raw.map((r) => {
    const { done_by_name, created_by_name, ...row } = r;
    return {
      ...row,
      lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
      lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
      materials: cleanMaterials((row as { materials?: unknown }).materials),
      done_by: done_by_name || created_by_name || null,
    };
  });
}

export async function loadJobInvoices(db: Db, type: JobType): Promise<InvoiceSnapshot[]> {
  const { data, error } = await db
    .from("job_invoices")
    .select(JOB_SNAPSHOT_COLS)
    .eq("jtype", type)
    .order("month", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as InvoiceSnapshot[]).map((i) => ({
    ...i,
    id: Number(i.id),
    city: isCity(i.city) ? i.city : "bozeman",
    job_ids: (i.job_ids ?? []).map(Number),
    date_from: i.date_from ?? null,
    date_to: i.date_to ?? null,
  }));
}

/** The sent invoice a job is on, if any (a job on a sent invoice can't be deleted or moved to the other city). */
export async function sentInvoiceFor(db: Db, type: JobType, id: number): Promise<InvoiceSnapshot | null> {
  const invoices = await loadJobInvoices(db, type);
  return invoices.find((i) => i.job_ids.includes(id)) ?? null;
}
