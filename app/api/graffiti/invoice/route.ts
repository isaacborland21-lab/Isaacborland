import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildInvoiceXlsx } from "@/lib/invoiceXlsx";
import {
  buildCsv,
  buildInvoice,
  clean,
  diffSnapshot,
  isMonth,
  localDate,
  localMonth,
  monthTable,
  unbilledMonths,
} from "@/lib/graffiti";
import {
  BUCKET,
  TEMPLATE_PATH,
  billingFor,
  defaultInvoiceNo,
  fail,
  isResponse,
  loadFinished,
  loadInvoices,
  loadSettings,
  requireInvoice,
} from "@/lib/graffitiServer";

export const dynamic = "force-dynamic";

/** Last day of a YYYY-MM month as YYYY-MM-DD (the template's Date box shows the month end). */
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
export const revalidate = 0;
export const fetchCache = "force-no-store";

// The invoice shows the hourly rate and the totals, so it is for the owner and for crew accounts the owner switched "invoice" on for.
// Un-marking a month stays owner-only.

// GET /api/graffiti/invoice?month=YYYY-MM           -> the invoice for that month (JSON)
// GET /api/graffiti/invoice?month=YYYY-MM&format=csv -> spreadsheet for your own records
// GET /api/graffiti/invoice?month=YYYY-MM&format=xlsx&date=YYYY-MM-DD -> the invoice in your template's layout (opens in Google Sheets)
export async function GET(request: Request) {
  const who = await requireInvoice();
  if (isResponse(who)) return who;

  const url = new URL(request.url);
  const db = getSupabaseAdmin();
  try {
    const [settings, rows, invoices] = await Promise.all([loadSettings(db), loadFinished(db), loadInvoices(db)]);
    const tz = settings.tz;
    const currentMonth = localMonth(new Date().toISOString(), tz);
    const wanted = url.searchParams.get("month");
    if (wanted !== null && !isMonth(wanted)) return fail("Bad month (use YYYY-MM).", 400);
    const month = wanted ?? currentMonth;

    const snapshot = invoices.find((i) => i.month === month) ?? null;
    const bill = billingFor(settings, snapshot);
    // an invoiced month keeps its number; otherwise the page may suggest one (?inv=) for the CSV / header
    const invoiceNo = snapshot?.invoice_no ?? clean(url.searchParams.get("inv"), 40) ?? defaultInvoiceNo(month);
    const build = buildInvoice(rows, { month, tz, ...bill });

    if (url.searchParams.get("format") === "csv") {
      const csv = buildCsv(build, { invNo: invoiceNo, tz, rateCents: bill.rateCents });
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="graffiti-invoice-${month}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.searchParams.get("format") === "xlsx") {
      const { data: file, error: dlErr } = await db.storage.from(BUCKET).download(TEMPLATE_PATH);
      if (dlErr || !file) return fail("Upload your invoice template first (Invoice page → Google Sheets invoice).", 404);
      if (build.tot.jobs === 0) return fail(`There are no finished tags in ${month} to invoice.`, 400);
      // The template bills in half-hour steps with a half-hour minimum (that is what its formulas do),
      // so the sheet always uses 30 / 30 whatever the on-screen rounding setting is.
      const sheetBuild = buildInvoice(rows, { month, tz, rateCents: bill.rateCents, minMin: 30, roundTo: 30 });
      const dateParam = url.searchParams.get("date") ?? "";
      const invoiceDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && !Number.isNaN(Date.parse(dateParam)) ? dateParam : snapshot?.invoice_date ?? monthEnd(month);
      try {
        const bytes = await buildInvoiceXlsx(new Uint8Array(await file.arrayBuffer()), sheetBuild, {
          invoiceDate,
          invoiceNo,
          poNumber: settings.po_number,
          terms: settings.terms,
          billTo: settings.bill_to.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5),
          rateCents: bill.rateCents,
          tz,
        });
        return new Response(bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="graffiti-invoice-${month}.xlsx"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Could not build the spreadsheet.", 500);
      }
    }

    const diff = snapshot ? diffSnapshot(snapshot.job_ids, build.ids) : { added: [] as number[], dropped: [] as number[] };
    // Same tags but different minutes / amount (e.g. a time was corrected after sending)?
    const changed = !!snapshot && (snapshot.total_cents !== build.tot.cents || snapshot.billed_min !== build.tot.billed || snapshot.actual_min !== build.tot.actual);
    const months = monthTable(rows.map((r) => r.removed_at), invoices, tz);

    return NextResponse.json(
      {
        month,
        currentMonth,
        settings,
        snapshot,
        build,
        diff,
        changed,
        months,
        unbilled: unbilledMonths(months, currentMonth),
        invoiceNo,
        viewer: { owner: who.owner },
        today: localDate(new Date().toISOString(), tz),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not build the invoice.", 500);
  }
}

// POST { action: "mark" | "unmark", month, invoice_no?, invoice_date? }
// "mark" freezes the month: rate, minimum, totals and the exact list of tags that were invoiced.
export async function POST(request: Request) {
  const who = await requireInvoice();
  if (isResponse(who)) return who;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Invalid body.", 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("Invalid JSON body.", 400);
  }
  const month = body.month;
  if (!isMonth(month)) return fail("Bad month (use YYYY-MM).", 400);
  if (body.action !== "mark" && body.action !== "unmark") return fail("Bad action.", 400);

  const db = getSupabaseAdmin();

  if (body.action === "unmark") {
    // undoing a sent invoice rewrites a financial record: owner only
    if (!who.owner) return fail("Only the owner can undo an invoiced month.", 403);
    const { error } = await db.from("graffiti_invoices").delete().eq("month", month);
    if (error) return fail(error.message, 500);
    return NextResponse.json({ ok: true });
  }

  try {
    const [settings, rows, invoices] = await Promise.all([loadSettings(db), loadFinished(db), loadInvoices(db)]);
    const tz = settings.tz;
    if (invoices.some((i) => i.month === month)) return fail(`${month} is already marked as invoiced.`, 409);
    if (month > localMonth(new Date().toISOString(), tz)) return fail("That month hasn't happened yet.", 400);

    const bill = billingFor(settings, null);
    if (bill.rateCents <= 0) return fail("Set your hourly rate in Billing settings before marking a month invoiced.", 400);
    const build = buildInvoice(rows, { month, tz, ...bill });
    if (build.tot.jobs === 0) return fail("There are no finished tags in that month.", 400);

    const dateRaw = typeof body.invoice_date === "string" ? body.invoice_date.trim() : "";
    if (dateRaw !== "" && !(/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) && !Number.isNaN(Date.parse(dateRaw)))) return fail("Bad invoice date.", 400);
    const invoiceNo = clean(typeof body.invoice_no === "string" ? body.invoice_no : "", 40) ?? defaultInvoiceNo(month);

    const { error } = await db.from("graffiti_invoices").insert({
      month,
      invoice_no: invoiceNo,
      invoice_date: dateRaw || localDate(new Date().toISOString(), tz),
      invoiced_at: new Date().toISOString(),
      invoiced_by: who.userId,
      jobs: build.tot.jobs,
      actual_min: build.tot.actual,
      billed_min: build.tot.billed,
      total_cents: build.tot.cents,
      rate_cents: bill.rateCents,
      min_minutes: bill.minMin,
      round_to: bill.roundTo,
      job_ids: build.ids,
    });
    if (error) {
      // the primary key on `month` makes a double-tap / second device fail cleanly
      return fail(error.code === "23505" ? `${month} is already marked as invoiced.` : error.message, error.code === "23505" ? 409 : 500);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not mark the month invoiced.", 500);
  }
}
