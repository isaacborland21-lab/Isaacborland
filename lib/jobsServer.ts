import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { canEditTab, canInvoice, PublicMetadata } from "@/lib/supabaseAdmin";
import { Job, JOB_TYPES, JobType, Material } from "@/lib/jobs";
import { displayName, fail } from "@/lib/graffitiServer";

// Server-only helpers for the job API routes (work orders / lawn care / other jobs). Never import from a client component.
// Photos, names, JSON parsing and the fail() helper are shared with the graffiti tracker (lib/graffitiServer.ts).

export const JOB_COLS =
  "id, jtype, status, title, wo_number, city, address, lat, lng, description, notes, bill_mode, price_cents, materials, before_photo, after_photo, started_at, finished_at, done_at, duration_min, created_at, created_by, created_by_name, done_by_name";

export type JobWho = { userId: string; owner: boolean; name: string; /** may see and change prices (owner, or the invoice switch on this tab) */ canBill: boolean };

/** Signed in AND allowed on this job tab (owner, or granted the tab in the Admin tab). */
export async function requireJobs(type: JobType): Promise<JobWho | NextResponse> {
  const { userId } = auth();
  if (!userId) return fail("Not signed in.", 401);
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = user.publicMetadata as PublicMetadata;
  if (!canEditTab(meta, type)) return fail("Not permitted to use this tab.", 403);
  return { userId, owner: meta.owner === true, name: displayName(user), canBill: canInvoice(meta, type) };
}

/** Signed in AND allowed on at least one of the job tabs (used for job photos, which are shared by the three tabs). */
export async function requireAnyJobTab(): Promise<JobWho | NextResponse> {
  const { userId } = auth();
  if (!userId) return fail("Not signed in.", 401);
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = user.publicMetadata as PublicMetadata;
  if (!JOB_TYPES.some((t) => canEditTab(meta, t))) return fail("Not permitted.", 403);
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
