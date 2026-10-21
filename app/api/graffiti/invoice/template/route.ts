import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildInvoice, InvoiceRow } from "@/lib/graffiti";
import { buildInvoiceXlsx } from "@/lib/invoiceXlsx";
import { BUCKET, fail, isResponse, requireGraffiti, TEMPLATE_PATH } from "@/lib/graffitiServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const MAX_TEMPLATE_BYTES = 4 * 1024 * 1024;
const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // an .xlsx is a zip file

// The invoice layout is the owner's own spreadsheet. It lives in the private storage bucket (the code
// is public, the logo and letterhead are not), so it is uploaded once from the invoice page.

/** Is a template stored? Owner only. */
export async function GET() {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;
  const db = getSupabaseAdmin();
  const { data, error } = await db.storage.from(BUCKET).list("templates", { limit: 10 });
  if (error) return fail(error.message, 500);
  const file = (data ?? []).find((f) => `templates/${f.name}` === TEMPLATE_PATH);
  return NextResponse.json({ exists: !!file, updated_at: file?.updated_at ?? null }, { headers: { "Cache-Control": "no-store" } });
}

/** Upload (or replace) the template. It is test-built once before it is saved, so a wrong file is rejected here. */
export async function POST(request: Request) {
  const who = await requireGraffiti(true);
  if (isResponse(who)) return who;

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f && typeof f !== "string" && f.size > 0) file = f;
  } catch {
    return fail("Invalid upload.", 400);
  }
  if (!file) return fail("Choose the invoice spreadsheet (.xlsx) to upload.", 400);
  if (file.size > MAX_TEMPLATE_BYTES) return fail("That file is too large (4 MB max).", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 4 || XLSX_MAGIC.some((b, i) => bytes[i] !== b)) {
    return fail("That is not an .xlsx file. In Google Sheets use File → Download → Microsoft Excel (.xlsx).", 400);
  }

  // dry run with one made-up job: proves the file matches the layout the generator expects
  try {
    const sample: InvoiceRow = {
      id: 1, gtype: "ssr", address: "Test", notes: null, description: null, lat: 0, lng: 0, before_photo: null, after_photo: null,
      started_at: null, finished_at: "2026-01-15T18:00:00Z", removed_at: "2026-01-15T18:00:00Z", duration_min: 10,
      gkind: null, surface: null, chemical: null, done_by: "Test",
    };
    const build = buildInvoice([sample], { month: "2026-01", tz: "America/Denver", rateCents: 8000, minMin: 30, roundTo: 30 });
    await buildInvoiceXlsx(bytes, build, { invoiceDate: "2026-01-31", invoiceNo: "TEST", poNumber: "", terms: "", billTo: [], rateCents: 8000, tz: "America/Denver" });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "That file does not match the invoice layout.", 400);
  }

  const db = getSupabaseAdmin();
  const { error } = await db.storage.from(BUCKET).upload(TEMPLATE_PATH, bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  if (error) return fail(`Could not save the template: ${error.message}`, 500);
  return NextResponse.json({ ok: true });
}
