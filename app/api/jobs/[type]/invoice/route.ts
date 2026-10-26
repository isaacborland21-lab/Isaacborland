import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { CITIES, CITY_NAMES, City, clean, diffSnapshot, isCity, isMonth, localDate, localMonth, unbilledMonths } from "@/lib/graffiti";
import { JobType, isJobType } from "@/lib/jobs";
import { buildJobCsv, buildJobInvoice, jobBilling, jobInvoiceNo, jobMonthTable } from "@/lib/jobInvoice";
import { fail, isResponse } from "@/lib/graffitiServer";
import { loadDoneJobs, loadJobInvoices, loadJobSettings, requireJobInvoice } from "@/lib/jobsServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// The invoice shows prices and totals, so it is for the owner and for crew accounts with this tab AND the invoice switch.
// Un-marking an invoice and the rates stay owner-only.
//
// GET /api/jobs/<type>/invoice?month=YYYY-MM&city=helena                  -> the page data (JSON)
// GET ...&format=csv[&ids=1,2,3][&invoice=<id>][&inv=]                     -> download the ticked jobs, or a sent invoice
const idList = (raw: string | null): number[] | null => {
  if (raw === null) return null;
  const ids = raw.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)].slice(0, 2000);
};

export async function GET(request: Request, { params }: { params: { type: string } }) {
  if (!isJobType(params.type)) return fail("Unknown job type.", 404);
  const type: JobType = params.type;
  const who = await requireJobInvoice(type);
  if (isResponse(who)) return who;

  const url = new URL(request.url);
  const db = getSupabaseAdmin();
  try {
    const [{ shared, job: S }, rows, invoices] = await Promise.all([loadJobSettings(db, type), loadDoneJobs(db, type), loadJobInvoices(db, type)]);
    const tz = shared.tz;
    const currentMonth = localMonth(new Date().toISOString(), tz);
    const wanted = url.searchParams.get("month");
    if (wanted !== null && !isMonth(wanted)) return fail("Bad month (use YYYY-MM).", 400);
    const month = wanted ?? currentMonth;
    const cityParam = url.searchParams.get("city");
    if (cityParam !== null && !isCity(cityParam)) return fail("Bad city.", 400);

    const billedIds = new Set(invoices.flatMap((i) => i.job_ids));
    const unbilledRows = rows.filter((r) => !billedIds.has(r.id));
    const bill = jobBilling(S, null);
    const unbilledBy = (c: City) => buildJobInvoice(unbilledRows, { month, tz, ...bill, city: c }).tot.jobs;
    // no city asked for: open the one with the most jobs still to invoice this month
    const city: City = cityParam ?? (unbilledBy("helena") > unbilledBy("bozeman") ? "helena" : "bozeman");

    const sent = invoices.filter((i) => i.city === city && i.month === month);
    const nextNo = jobInvoiceNo(type, month, city, sent.length + 1);
    const ids = idList(url.searchParams.get("ids"));
    const sentId = url.searchParams.get("invoice");
    const picked = sentId !== null ? sent.find((i) => String(i.id) === sentId) : undefined;
    if (sentId !== null && !picked) return fail("That invoice was not found for this city and month.", 404);

    if (url.searchParams.get("format") === "csv") {
      const src = picked
        ? { no: picked.invoice_no, terms: jobBilling(S, picked), only: picked.job_ids, rows }
        : { no: clean(url.searchParams.get("inv"), 40) ?? nextNo, terms: bill, only: ids ?? undefined, rows: unbilledRows };
      const build = buildJobInvoice(src.rows, { month, tz, ...src.terms, city, only: src.only });
      const csv = buildJobCsv(build, { invNo: src.no, tz, rateCents: src.terms.rateCents });
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${type}-invoice-${city}-${month}${picked ? `-${picked.id}` : ""}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // each sent invoice, rebuilt from its own job list and the terms it was sent with, plus what changed since
    const sentOut = sent.map((snap) => {
      const b = buildJobInvoice(rows, { month, tz, ...jobBilling(S, snap), city, only: snap.job_ids });
      const diff = diffSnapshot(snap.job_ids, b.ids);
      const changed = snap.total_cents !== b.tot.cents || snap.billed_min !== b.tot.billed || snap.actual_min !== b.tot.actual;
      return { snapshot: snap, build: b, dropped: diff.dropped, changed };
    });
    const working = buildJobInvoice(unbilledRows, { month, tz, ...bill, city });
    const months = jobMonthTable(rows, invoices, tz, city);
    const counts = Object.fromEntries(CITIES.map((c) => [c, unbilledBy(c)])) as Record<City, number>;

    return NextResponse.json(
      {
        type,
        month,
        city,
        currentMonth,
        shared,
        settings: S, // rates are visible to anyone allowed on this invoice (they see the totals anyway)
        build: working,
        sent: sentOut,
        months,
        unbilled: unbilledMonths(months, currentMonth),
        counts,
        invoiceNo: nextNo,
        viewer: { owner: who.owner },
        today: localDate(new Date().toISOString(), tz),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not build the invoice.", 500);
  }
}

// POST { action: "mark", month, city, ids, invoice_no?, invoice_date? }  -> a sent invoice for exactly those jobs
// POST { action: "unmark", id }                                          -> undo a sent invoice (owner only)
// POST { action: "set_city", id, city }                                  -> move one job to the other city
export async function POST(request: Request, { params }: { params: { type: string } }) {
  if (!isJobType(params.type)) return fail("Unknown job type.", 404);
  const type: JobType = params.type;
  const who = await requireJobInvoice(type);
  if (isResponse(who)) return who;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Invalid body.", 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return fail("Invalid JSON body.", 400);
  }
  if (body.action !== "mark" && body.action !== "unmark" && body.action !== "set_city") return fail("Bad action.", 400);

  const db = getSupabaseAdmin();

  if (body.action === "set_city") {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail("Bad id.", 400);
    if (!isCity(body.city)) return fail("Bad city.", 400);
    try {
      const sent = (await loadJobInvoices(db, type)).find((i) => i.job_ids.includes(id));
      if (sent) return fail(`That job is already on invoice ${sent.invoice_no}. Undo it first to move the job.`, 409);
      const { data, error } = await db.from("jobs").update({ city: body.city }).eq("id", id).eq("jtype", type).select("id").maybeSingle();
      if (error) return fail(error.message, 500);
      if (!data) return fail("Job not found.", 404);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not move the job.", 500);
    }
  }

  if (body.action === "unmark") {
    // undoing a sent invoice rewrites a financial record: owner only
    if (!who.owner) return fail("Only the owner can undo an invoice.", 403);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail("Bad invoice id.", 400);
    const { error } = await db.from("job_invoices").delete().eq("id", id).eq("jtype", type);
    if (error) return fail(error.message, 500);
    return NextResponse.json({ ok: true });
  }

  const month = body.month;
  if (!isMonth(month)) return fail("Bad month (use YYYY-MM).", 400);
  const city = body.city;
  if (!isCity(city)) return fail("Choose Helena or Bozeman.", 400);
  const wanted = Array.isArray(body.ids) ? [...new Set((body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  if (wanted.length === 0) return fail("Tick at least one job to invoice.", 400);

  try {
    const [{ shared, job: S }, rows, invoices] = await Promise.all([loadJobSettings(db, type), loadDoneJobs(db, type), loadJobInvoices(db, type)]);
    const tz = shared.tz;
    if (month > localMonth(new Date().toISOString(), tz)) return fail("That month hasn't happened yet.", 400);

    const bill = jobBilling(S, null);

    // only jobs done that month, in that city and on no sent invoice yet can go on a new one
    const billedIds = new Set(invoices.flatMap((i) => i.job_ids));
    const open = rows.filter((r) => !billedIds.has(r.id));
    const eligible = new Set(buildJobInvoice(open, { month, tz, ...bill, city }).ids);
    const bad = wanted.filter((id) => !eligible.has(id));
    if (bad.length > 0) {
      return fail(
        `Job ${bad.map((n) => "#" + n).join(", ")} can't go on this ${CITY_NAMES[city]} invoice (already invoiced, or not a finished ${month} job in this city). Reload the page.`,
        409,
      );
    }
    const build = buildJobInvoice(rows, { month, tz, ...bill, city, only: wanted });

    // hourly jobs need the rate; flat jobs need their price
    if (build.lines.some((l) => l.bill_mode !== "flat") && bill.rateCents <= 0) {
      return fail("Set the hourly rate in Billing settings before marking hourly jobs invoiced.", 400);
    }
    if (build.warn.noprice.length > 0) {
      return fail(`Job ${build.warn.noprice.map((n) => "#" + n).join(", ")} is a flat-price job with no price. Set the price first.`, 400);
    }

    const dateRaw = typeof body.invoice_date === "string" ? body.invoice_date.trim() : "";
    if (dateRaw !== "" && !(/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) && !Number.isNaN(Date.parse(dateRaw)))) return fail("Bad invoice date.", 400);
    const nthSame = invoices.filter((i) => i.city === city && i.month === month).length + 1;
    const invoiceNo = clean(typeof body.invoice_no === "string" ? body.invoice_no : "", 40) ?? jobInvoiceNo(type, month, city, nthSame);
    if (invoices.some((i) => i.invoice_no === invoiceNo)) return fail(`Invoice number ${invoiceNo} is already used. Pick another.`, 409);

    const { error } = await db.from("job_invoices").insert({
      jtype: type,
      city,
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
    if (error) return fail(error.message, 500);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not mark the jobs invoiced.", 500);
  }
}
