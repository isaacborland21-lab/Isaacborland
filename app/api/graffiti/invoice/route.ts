import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildInvoiceXlsx } from "@/lib/invoiceXlsx";
import {
  CITIES,
  CITY_NAMES,
  City,
  billToFor,
  buildCsv,
  buildInvoice,
  clean,
  diffSnapshot,
  isCity,
  isMonth,
  localDate,
  localMonth,
  poFor,
  monthTable,
  unbilledMonths,
  parsePeriod,
  periodOf,
  rangeInvoiceNo,
  rangesOverlap,
  snapRange,
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

export const revalidate = 0;
export const fetchCache = "force-no-store";


// The invoice shows the hourly rate and the totals, so it is for the owner and for crew accounts the owner switched "invoice" on for.
// Un-marking a month stays owner-only.

// Every tag finished in a city/month is either on a sent invoice or still "unbilled". The working invoice
// is the unbilled ones (the page ticks which of them go on it); sent invoices keep their exact tag list.
//
// GET /api/graffiti/invoice?month=YYYY-MM&city=helena           -> the page data (JSON)
// GET /api/graffiti/invoice?from=YYYY-MM-DD&to=YYYY-MM-DD&city=helena  -> same, for a date range instead of a month
// GET ...&format=csv|xlsx[&ids=1,2,3][&invoice=<id>][&date=][&inv=] -> download the ticked tags, or a sent invoice
const idList = (raw: string | null): number[] | null => {
  if (raw === null) return null;
  const ids = raw.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)].slice(0, 2000);
};

export async function GET(request: Request) {
  const who = await requireInvoice();
  if (isResponse(who)) return who;

  const url = new URL(request.url);
  const db = getSupabaseAdmin();
  try {
    const [settings, rows, invoices] = await Promise.all([loadSettings(db), loadFinished(db), loadInvoices(db)]);
    const tz = settings.tz;
    const currentMonth = localMonth(new Date().toISOString(), tz);
    // a whole month (default), or a date range with ?from=YYYY-MM-DD&to=YYYY-MM-DD (both days included)
    const per = parsePeriod({ month: url.searchParams.get("month"), from: url.searchParams.get("from"), to: url.searchParams.get("to") }, currentMonth);
    if (!per.ok) return fail(per.error, 400);
    const { month, range } = per;
    const span = periodOf({ month, date_from: range?.from, date_to: range?.to });
    const period = range ? { from: range.from, to: range.to } : {};
    const cityParam = url.searchParams.get("city");
    if (cityParam !== null && !isCity(cityParam)) return fail("Bad city.", 400);

    const billedIds = new Set(invoices.flatMap((i) => i.job_ids));
    const unbilledRows = rows.filter((r) => !billedIds.has(r.id));
    // no city asked for: open the one with the most tags still to invoice this month
    const unbilledBy = (c: City) => buildInvoice(unbilledRows, { month, tz, ...period, rateCents: 0, minMin: 0, roundTo: 1, city: c }).tot.jobs;
    const city: City = cityParam ?? (unbilledBy("helena") > unbilledBy("bozeman") ? "helena" : "bozeman");

    // sent invoices that cover any of the days on screen (a month invoice, or a range invoice that overlaps)
    const sent = invoices.filter((i) => i.city === city && rangesOverlap(periodOf(i), span));
    const bill = billingFor(settings, null);
    const nextNo = range
      ? rangeInvoiceNo(city, range.from, range.to, invoices.map((i) => i.invoice_no))
      : defaultInvoiceNo(month, city, invoices.filter((i) => i.city === city && i.month === month && !i.date_from).length + 1);
    const ids = idList(url.searchParams.get("ids"));
    const sentId = url.searchParams.get("invoice");
    const picked = sentId !== null ? sent.find((i) => String(i.id) === sentId) : undefined;
    if (sentId !== null && !picked) return fail("That invoice was not found for this city and month.", 404);

    // what a download is built from: a sent invoice (its own frozen terms and tags), or the ticked unbilled tags
    const src = picked
      ? { snap: picked, no: picked.invoice_no, terms: billingFor(settings, picked), only: picked.job_ids, rows }
      : { snap: null, no: clean(url.searchParams.get("inv"), 40) ?? nextNo, terms: bill, only: ids ?? undefined, rows: unbilledRows };
    // a sent invoice is always rebuilt over its own days; the working invoice over the days on screen
    const own = picked ? { month: picked.month, ...snapRange(picked) } : { month, ...period };
    const build = buildInvoice(src.rows, { ...own, tz, ...src.terms, city, only: src.only });
    const slug = `${city}-${range ? `${range.from}_${range.to}` : month}${picked ? `-${picked.id}` : ""}`;

    if (url.searchParams.get("format") === "csv") {
      const csv = buildCsv(build, { invNo: src.no, tz, rateCents: src.terms.rateCents });
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="graffiti-invoice-${slug}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.searchParams.get("format") === "xlsx") {
      const { data: file, error: dlErr } = await db.storage.from(BUCKET).download(TEMPLATE_PATH);
      if (dlErr || !file) return fail("Upload your invoice template first (Invoice page → Google Sheets invoice).", 404);
      if (build.tot.jobs === 0) return fail(`There are no tags selected for this ${CITY_NAMES[city]} invoice.`, 400);
      // The template bills in half-hour steps with a half-hour minimum (that is what its formulas do),
      // so the sheet always uses 30 / 30 whatever the on-screen rounding setting is.
      const sheetBuild = buildInvoice(src.rows, { ...own, tz, rateCents: src.terms.rateCents, minMin: 30, roundTo: 30, city, only: src.only });
      const dateParam = url.searchParams.get("date") ?? "";
      const invoiceDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && !Number.isNaN(Date.parse(dateParam)) ? dateParam : src.snap?.invoice_date ?? (picked ? periodOf(picked).to : span.to);
      try {
        const bytes = await buildInvoiceXlsx(new Uint8Array(await file.arrayBuffer()), sheetBuild, {
          invoiceDate,
          invoiceNo: src.no,
          poNumber: poFor(settings, city),
          terms: settings.terms,
          billTo: billToFor(settings, city).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5),
          rateCents: src.terms.rateCents,
          tz,
        });
        return new Response(bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="graffiti-invoice-${slug}.xlsx"`,
            "Cache-Control": "no-store",
          },
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : "Could not build the spreadsheet.", 500);
      }
    }

    // each sent invoice, rebuilt from its own tag list and the terms it was sent with, plus what changed since
    const sentOut = sent.map((snap) => {
      const b = buildInvoice(rows, { month: snap.month, ...snapRange(snap), tz, ...billingFor(settings, snap), city, only: snap.job_ids });
      const diff = diffSnapshot(snap.job_ids, b.ids);
      const changed = snap.total_cents !== b.tot.cents || snap.billed_min !== b.tot.billed || snap.actual_min !== b.tot.actual;
      return { snapshot: snap, build: b, dropped: diff.dropped, changed };
    });
    const working = buildInvoice(unbilledRows, { month, ...period, tz, ...bill, city });
    const months = monthTable(rows, invoices, tz, city);
    // tags still to invoice this month, per city (for the Helena / Bozeman switch)
    const counts = Object.fromEntries(CITIES.map((c) => [c, unbilledBy(c)])) as Record<City, number>;

    return NextResponse.json(
      {
        month,
        from: range?.from ?? null,
        to: range?.to ?? null,
        city,
        currentMonth,
        settings,
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

// POST { action: "mark", month, city, ids, invoice_no?, invoice_date? }  -> a sent invoice for exactly those tags
// POST { action: "unmark", id }                                          -> undo a sent invoice (owner only)
// POST { action: "set_city", id, city: "bozeman" | "helena" | "" }       -> move one tag to the other city ("" = back to automatic)
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
  if (body.action !== "mark" && body.action !== "unmark" && body.action !== "set_city") return fail("Bad action.", 400);

  const db = getSupabaseAdmin();

  if (body.action === "set_city") {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail("Bad id.", 400);
    const c = body.city === "" ? null : body.city;
    if (c !== null && !isCity(c)) return fail("Bad city.", 400);
    try {
      const invoices = await loadInvoices(db);
      const sent = invoices.find((i) => i.job_ids.includes(id));
      if (sent) return fail(`That tag is already on invoice ${sent.invoice_no}. Undo it first to move the tag.`, 409);
      const { data, error } = await db.from("graffiti_incidents").update({ city: c }).eq("id", id).select("id").maybeSingle();
      if (error) return fail(error.message, 500);
      if (!data) return fail("Incident not found.", 404);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not move the tag.", 500);
    }
  }

  if (body.action === "unmark") {
    // undoing a sent invoice rewrites a financial record: owner only
    if (!who.owner) return fail("Only the owner can undo an invoice.", 403);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return fail("Bad invoice id.", 400);
    const { error } = await db.from("graffiti_invoices").delete().eq("id", id);
    if (error) return fail(error.message, 500);
    return NextResponse.json({ ok: true });
  }

  const parsed = parsePeriod({ month: body.month, from: body.from, to: body.to }, "");
  if (!parsed.ok) return fail(parsed.error, 400);
  if (!parsed.range && !isMonth(body.month)) return fail("Bad month (use YYYY-MM).", 400);
  const { month, range } = parsed;
  const period = range ? { from: range.from, to: range.to } : {};
  const city = body.city;
  if (!isCity(city)) return fail("Choose Helena or Bozeman.", 400);
  const wanted = Array.isArray(body.ids) ? [...new Set((body.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  if (wanted.length === 0) return fail("Tick at least one tag to invoice.", 400);

  try {
    const [settings, rows, invoices] = await Promise.all([loadSettings(db), loadFinished(db), loadInvoices(db)]);
    const tz = settings.tz;
    if (range ? range.from > localDate(new Date().toISOString(), tz) : month > localMonth(new Date().toISOString(), tz)) return fail(range ? "That date range hasn't started yet." : "That month hasn't happened yet.", 400);

    const bill = billingFor(settings, null);
    if (bill.rateCents <= 0) return fail("Set your hourly rate in Billing settings before marking tags invoiced.", 400);

    // only tags that are finished that month, in that city and on no sent invoice yet can go on a new one
    const billedIds = new Set(invoices.flatMap((i) => i.job_ids));
    const open = new Set(rows.filter((r) => !billedIds.has(r.id)).map((r) => r.id));
    const eligible = new Set(buildInvoice(rows.filter((r) => open.has(r.id)), { month, ...period, tz, ...bill, city }).ids);
    const bad = wanted.filter((id) => !eligible.has(id));
    if (bad.length > 0) {
      return fail(
        `Job ${bad.map((n) => "#" + n).join(", ")} can't go on this ${CITY_NAMES[city]} invoice (already invoiced, or not a finished tag in this city for ${range ? `${range.from} to ${range.to}` : month}). Reload the page.`,
        409,
      );
    }
    const build = buildInvoice(rows, { month, ...period, tz, ...bill, city, only: wanted });

    const dateRaw = typeof body.invoice_date === "string" ? body.invoice_date.trim() : "";
    if (dateRaw !== "" && !(/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) && !Number.isNaN(Date.parse(dateRaw)))) return fail("Bad invoice date.", 400);
    const nthSame = invoices.filter((i) => i.city === city && i.month === month && !i.date_from).length + 1;
    const invoiceNo =
      clean(typeof body.invoice_no === "string" ? body.invoice_no : "", 40) ??
      (range ? rangeInvoiceNo(city, range.from, range.to, invoices.map((i) => i.invoice_no)) : defaultInvoiceNo(month, city, nthSame));
    if (invoices.some((i) => i.invoice_no === invoiceNo)) return fail(`Invoice number ${invoiceNo} is already used. Pick another.`, 409);

    const { error } = await db.from("graffiti_invoices").insert({
      city,
      month,
      date_from: range ? range.from : null,
      date_to: range ? range.to : null,
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
    return fail(e instanceof Error ? e.message : "Could not mark the tags invoiced.", 500);
  }
}
