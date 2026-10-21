import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { randomBytes } from "crypto";
import { canEditTab, getSupabaseAdmin, PublicMetadata } from "@/lib/supabaseAdmin";
import {
  BillingSettings,
  Fields,
  Incident,
  InvoiceRow,
  InvoiceSnapshot,
  MAX_PHOTO_BYTES,
  mergeSettings,
} from "@/lib/graffiti";

// Server-only helpers for the graffiti API routes. Never import from a client component.

export type Db = ReturnType<typeof getSupabaseAdmin>;
export const BUCKET = "graffiti";

export const INCIDENT_COLS =
  "id, status, lat, lng, address, gtype, description, notes, before_photo, after_photo, reported_at, scheduled_for, started_at, finished_at, removed_at, duration_min, report_photo, reported_by_name, urgent, claimed_by, claimed_by_name, created_by";
export const INVOICE_ROW_COLS =
  "id, gtype, address, notes, description, lat, lng, before_photo, after_photo, started_at, finished_at, removed_at, duration_min";
export const SNAPSHOT_COLS =
  "month, invoice_no, invoice_date, invoiced_at, jobs, actual_min, billed_min, total_cents, rate_cents, min_minutes, round_to, job_ids";

export const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export type Who = { userId: string; owner: boolean; name: string };

/**
 * Signed in AND allowed on the graffiti tab (owner, or granted "graffiti" in the Admin tab).
 * With `ownerOnly`, only the site owner passes — used for rates and invoices, which crew must not see.
 */
export async function requireGraffiti(ownerOnly = false): Promise<Who | NextResponse> {
  const { userId } = auth();
  if (!userId) return fail("Not signed in.", 401);
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = user.publicMetadata as PublicMetadata;
  const owner = meta.owner === true;
  if (ownerOnly ? !owner : !canEditTab(meta, "graffiti")) {
    return fail(ownerOnly ? "Owner only." : "Not permitted to use the graffiti tracker.", 403);
  }
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || "Crew";
  return { userId, owner, name: name.slice(0, 80) };
}

/** Narrows a "result or an error response" value: true means send it straight back to the caller. */
export function isResponse<T>(v: T | NextResponse): v is NextResponse {
  return v instanceof Response;
}

/** Reads fields (and an optional photo) from a multipart form or a JSON body. */
export async function readInput(request: Request): Promise<{ fields: Fields; photo: File | null } | NextResponse> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const fields: Fields = {};
      let photo: File | null = null;
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") fields[k] = v;
        else if (k === "photo" && v.size > 0) photo = v;
      }
      return { fields, photo };
    }
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return fail("Invalid body.", 400);
    const fields: Fields = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (typeof v === "string") fields[k] = v;
      else if (typeof v === "number" || typeof v === "boolean") fields[k] = String(v);
      else if (v === null) fields[k] = "";
    }
    return { fields, photo: null };
  } catch {
    return fail("Invalid request body.", 400);
  }
}

/** Checks a JPEG upload by size and magic bytes (the browser already resizes and re-encodes it). */
export async function checkPhoto(file: File): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: "Photo is too large (4 MB max)." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, error: "Photo must be a JPEG image." };
  }
  return { ok: true, bytes };
}

export async function uploadPhoto(db: Db, bytes: Uint8Array): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const name = `${randomBytes(16).toString("hex")}.jpg`;
  const { error } = await db.storage.from(BUCKET).upload(name, bytes, { contentType: "image/jpeg", upsert: false });
  if (error) return { ok: false, error: `Photo upload failed: ${error.message}` };
  return { ok: true, name };
}

export async function removePhotos(db: Db, names: (string | null | undefined)[]) {
  const list = names.filter((n): n is string => !!n);
  if (list.length === 0) return;
  try {
    await db.storage.from(BUCKET).remove(list);
  } catch {
    /* a leftover file is harmless; never fail the request over it */
  }
}

export function toIncident(row: Record<string, unknown>, userId: string): Incident {
  const { created_by, claimed_by, ...rest } = row as Record<string, unknown> & { created_by?: string; claimed_by?: string | null };
  return { ...(rest as unknown as Incident), mine: created_by === userId, claimed_by_me: !!claimed_by && claimed_by === userId };
}

export async function loadSettings(db: Db): Promise<BillingSettings> {
  const { data, error } = await db.from("graffiti_settings").select("k, v");
  if (error) throw new Error(error.message);
  return mergeSettings((data ?? []) as { k: string; v: string | null }[]);
}

const PAGE = 1000;

/** Pages through a query (Supabase returns at most 1000 rows per request). */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function loadFinished(db: Db): Promise<InvoiceRow[]> {
  return fetchAll<InvoiceRow>((a, b) =>
    db
      .from("graffiti_incidents")
      .select(INVOICE_ROW_COLS)
      .not("removed_at", "is", null)
      .order("removed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b) as unknown as PromiseLike<{ data: InvoiceRow[] | null; error: { message: string } | null }>,
  );
}

export async function loadInvoices(db: Db): Promise<InvoiceSnapshot[]> {
  const { data, error } = await db.from("graffiti_invoices").select(SNAPSHOT_COLS).order("month", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as InvoiceSnapshot[]).map((i) => ({
    ...i,
    job_ids: (i.job_ids ?? []).map(Number),
  }));
}

// Billing helpers live in the pure lib so the invoice page uses the very same math.
export { billingFor, defaultInvoiceNo, dollarsToCents } from "@/lib/graffiti";
