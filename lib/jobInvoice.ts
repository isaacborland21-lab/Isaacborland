import {
  City,
  InvoiceSnapshot,
  MAX_MINUTES,
  MonthRow,
  ROUND_OPTIONS,
  UNASSIGNED,
  billTag,
  csvSafe,
  dollarsToCents,
  localDate,
  localMonth,
  localStamp,
} from "@/lib/graffiti";
import { BillMode, JobType, Material, materialsTotal } from "@/lib/jobs";

// Pure invoicing logic for the work-order / lawn-care / other-jobs tabs: per-type settings, the bill for each job,
// month tables and the CSV. Shared by the API routes, the invoice page and the tests.

// ---------- Settings (one set per job type, stored as "<type>.<key>" rows in graffiti_settings) ----------

export type JobSettings = {
  rate: string; // dollars per hour
  min_minutes: string;
  round_to: string;
  bill_to: string; // Bozeman's invoices
  po_number: string;
  bill_to_helena: string;
  po_number_helena: string;
};

export const JOB_SETTING_DEFAULTS: JobSettings = {
  rate: "0",
  min_minutes: "30",
  round_to: "1",
  bill_to: "",
  po_number: "",
  bill_to_helena: "",
  po_number_helena: "",
};
export const JOB_SETTING_KEYS = Object.keys(JOB_SETTING_DEFAULTS) as (keyof JobSettings)[];
export const settingKey = (type: JobType, k: keyof JobSettings) => `${type}.${k}`;

export function mergeJobSettings(rows: { k: string; v: string | null }[], type: JobType): JobSettings {
  const s: JobSettings = { ...JOB_SETTING_DEFAULTS };
  for (const k of JOB_SETTING_KEYS) {
    const row = rows.find((r) => r.k === settingKey(type, k));
    if (row) s[k] = row.v ?? "";
  }
  return s;
}

/** Validates the settings form; anything invalid keeps its current value. */
export function sanitizeJobSettings(input: Record<string, unknown>, current: JobSettings): JobSettings {
  const str = (k: string, max: number) => String(input[k] ?? "").trim().slice(0, max);
  const next: JobSettings = {
    rate: current.rate,
    min_minutes: current.min_minutes,
    round_to: "1",
    bill_to: str("bill_to", 400),
    po_number: str("po_number", 80),
    bill_to_helena: str("bill_to_helena", 400),
    po_number_helena: str("po_number_helena", 80),
  };
  const rateRaw = String(input.rate ?? "").trim();
  const rate = Number(rateRaw);
  if (rateRaw !== "" && Number.isFinite(rate) && rate >= 0 && rate <= 10000) next.rate = String(Math.round(rate * 100) / 100);
  const minRaw = String(input.min_minutes ?? "").trim();
  if (/^\d+$/.test(minRaw) && Number(minRaw) <= MAX_MINUTES) next.min_minutes = String(Number(minRaw));
  const rt = Number(input.round_to);
  next.round_to = ROUND_OPTIONS.includes(rt) ? String(rt) : current.round_to;
  return next;
}

export const jobBillTo = (s: JobSettings, c: City) => (c === "helena" ? s.bill_to_helena : s.bill_to);
export const jobPoFor = (s: JobSettings, c: City) => (c === "helena" ? s.po_number_helena : s.po_number);

/** A sent invoice keeps the rate / minimum / rounding it was sent with; the next one uses today's settings. */
export function jobBilling(s: JobSettings, snap: Pick<InvoiceSnapshot, "rate_cents" | "min_minutes" | "round_to"> | null) {
  return {
    rateCents: snap ? snap.rate_cents : dollarsToCents(s.rate),
    minMin: snap ? snap.min_minutes : Number(s.min_minutes) || 0,
    roundTo: snap ? snap.round_to : Number(s.round_to) || 1,
  };
}

const CODE: Record<JobType, string> = { workorders: "WO", lawn: "LAWN", otherjobs: "JOB" };
/** INV-202610-WO-HEL, INV-202610-WO-HEL-2 for a second invoice the same month. */
export const jobInvoiceNo = (type: JobType, month: string, city: City, nth = 1) =>
  `INV-${month.replace("-", "")}-${CODE[type]}-${city.slice(0, 3).toUpperCase()}${nth > 1 ? `-${nth}` : ""}`;

/** INV-20261015-20261105-WO-HEL for a date range (a -2, -3... is added if that number is taken). */
export function jobRangeInvoiceNo(type: JobType, city: City, from: string, to: string, taken: string[] = []): string {
  const base = `INV-${from.replace(/-/g, "")}-${to.replace(/-/g, "")}-${CODE[type]}-${city.slice(0, 3).toUpperCase()}`;
  let n = 1;
  let no = base;
  while (taken.includes(no)) no = `${base}-${++n}`;
  return no;
}

// ---------- Building an invoice ----------

/** A finished job as the invoice needs it. */
export type JobInvoiceRow = {
  id: number;
  title: string;
  wo_number: string | null;
  city: City;
  address: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  description: string | null;
  bill_mode: BillMode;
  price_cents: number | null;
  materials: Material[];
  before_photo: string | null;
  after_photo: string | null;
  started_at: string | null;
  finished_at: string | null;
  done_at: string;
  duration_min: number | null;
  /** who finished it (worked out on the server); null = unknown */
  done_by: string | null;
};

export type JobLine = JobInvoiceRow & {
  actual: number | null; // real minutes on site
  billed: number; // minutes billed (0 for a flat-price job)
  hourlyCents: number;
  materialsCents: number;
  cents: number;
  minApplied: boolean;
  day: string;
  person: string;
};

export type JobTotals = { jobs: number; actual: number; billed: number; materials: number; cents: number };
export type JobPersonGroup = { name: string; lines: JobLine[]; tot: JobTotals };

export type JobBuild = {
  lines: JobLine[];
  people: JobPersonGroup[];
  ids: number[];
  byMode: Partial<Record<BillMode, JobTotals>>;
  tot: JobTotals;
  /** job ids that need a look before the invoice goes out */
  warn: { notime: number[]; noprice: number[]; noaddr: number[]; noafter: number[] };
};

const emptyTotals = (): JobTotals => ({ jobs: 0, actual: 0, billed: 0, materials: 0, cents: 0 });

/** What one job bills: hourly (minimum per job), flat price, or hourly + materials. */
export function billJob(
  r: Pick<JobInvoiceRow, "bill_mode" | "price_cents" | "materials" | "duration_min">,
  o: { rateCents: number; minMin: number; roundTo: number },
) {
  const actual = r.duration_min;
  if (r.bill_mode === "flat") {
    return { actual, billed: 0, hourlyCents: 0, materialsCents: 0, cents: r.price_cents ?? 0, minApplied: false };
  }
  const t = billTag(actual, o.minMin, o.roundTo, o.rateCents);
  const materialsCents = r.bill_mode === "hourly_materials" ? materialsTotal(r.materials) : 0;
  return { actual, billed: t.billed, hourlyCents: t.cents, materialsCents, cents: t.cents + materialsCents, minApplied: t.minApplied };
}

export function summarizeJobs(lines: JobLine[]): Pick<JobBuild, "people" | "byMode" | "tot"> {
  const out = { people: [] as JobPersonGroup[], byMode: {} as JobBuild["byMode"], tot: emptyTotals() };
  for (const line of lines) {
    let g = out.people.find((p) => p.name === line.person);
    if (!g) out.people.push((g = { name: line.person, lines: [], tot: emptyTotals() }));
    g.lines.push(line);
    const b = (out.byMode[line.bill_mode] ??= emptyTotals());
    for (const t of [g.tot, b, out.tot]) {
      t.jobs += 1;
      t.actual += line.actual ?? 0;
      t.billed += line.billed;
      t.materials += line.materialsCents;
      t.cents += line.cents;
    }
  }
  out.people.sort((a, b) => (a.name === UNASSIGNED ? 1 : b.name === UNASSIGNED ? -1 : a.name.localeCompare(b.name)));
  return out;
}

/**
 * Finished jobs done in `month` (local days in `tz`), with the bill worked out.
 * `city` keeps one city's jobs; `only` keeps just those job ids (the ones ticked for this invoice).
 */
export function buildJobInvoice(
  rows: JobInvoiceRow[],
  o: { month: string; tz: string; rateCents: number; minMin: number; roundTo: number; city?: City; only?: number[]; from?: string; to?: string },
): JobBuild {
  const only = o.only ? new Set(o.only) : null;
  const inRange = o.from && o.to ? { from: o.from, to: o.to } : null;
  const inMonth = rows
    .filter((r) => {
      if (!r.done_at) return false;
      // a date range (local days, both ends included) when one is given, otherwise the whole month
      if (inRange) {
        const d = localDate(r.done_at, o.tz);
        return d >= inRange.from && d <= inRange.to;
      }
      return localMonth(r.done_at, o.tz) === o.month;
    })
    .filter((r) => !o.city || r.city === o.city)
    .filter((r) => !only || only.has(r.id))
    .sort((a, b) => Date.parse(a.done_at) - Date.parse(b.done_at) || a.id - b.id);

  const lines: JobLine[] = [];
  const warn: JobBuild["warn"] = { notime: [], noprice: [], noaddr: [], noafter: [] };
  for (const r of inMonth) {
    const b = billJob(r, o);
    const person = (r.done_by ?? "").trim() || UNASSIGNED;
    lines.push({ ...r, ...b, day: localDate(r.done_at, o.tz), person });
    if (r.bill_mode !== "flat" && b.actual === null) warn.notime.push(r.id);
    if (r.bill_mode === "flat" && r.price_cents === null) warn.noprice.push(r.id);
    if (!r.address || r.address.trim() === "") warn.noaddr.push(r.id);
    if (!r.after_photo) warn.noafter.push(r.id);
  }
  return { lines, ids: lines.map((l) => l.id), warn, ...summarizeJobs(lines) };
}

/** Every month with finished work for one city (plus any it has invoices for), newest first. */
export function jobMonthTable(
  rows: { id: number; done_at: string; city: City }[],
  invoices: InvoiceSnapshot[],
  tz: string,
  city: City,
): MonthRow[] {
  const billed = new Set(invoices.flatMap((i) => i.job_ids));
  const map = new Map<string, MonthRow>();
  const row = (k: string) => {
    let r = map.get(k);
    if (!r) map.set(k, (r = { month: k, count: 0, unbilled: 0, invoices: [] }));
    return r;
  };
  for (const r of rows) {
    if (r.city !== city) continue;
    const m = row(localMonth(r.done_at, tz));
    m.count += 1;
    if (!billed.has(r.id)) m.unbilled += 1;
  }
  for (const i of invoices) if (i.city === city) row(i.month).invoices.push(i);
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** The wording on a row for how it was billed. */
export function billDescribe(l: Pick<JobLine, "bill_mode" | "billed" | "materialsCents" | "price_cents">, money: (c: number) => string): string {
  if (l.bill_mode === "flat") return "flat price";
  if (l.bill_mode === "hourly_materials") return `${l.billed} min + ${money(l.materialsCents)} materials`;
  return `${l.billed} min`;
}

// ---------- CSV (for your own records) ----------

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const MODE_TEXT: Record<BillMode, string> = { hourly: "Hourly", flat: "Flat price", hourly_materials: "Hours + materials" };

export function buildJobCsv(b: JobBuild, o: { invNo: string; tz: string; rateCents: number }): string {
  const head = [
    "Invoice", "Job #", "Work order #", "Title", "Date finished", "Done by", "City", "Location", "Billing", "Started", "Finished",
    "Actual minutes", "Billed minutes", "Minimum applied", "Rate per hour", "Hourly amount", "Materials", "Materials amount", "Flat price", "Amount", "Notes",
  ];
  const rows: (string | number | null)[][] = [head];
  for (const r of b.lines) {
    rows.push([
      o.invNo, r.id, csvSafe(r.wo_number), csvSafe(r.title), r.day, csvSafe(r.person), r.city === "helena" ? "Helena" : "Bozeman", csvSafe(r.address),
      MODE_TEXT[r.bill_mode],
      r.started_at ? localStamp(r.started_at, o.tz) : "", localStamp(r.finished_at ?? r.done_at, o.tz),
      r.actual, r.bill_mode === "flat" ? "" : r.billed, r.minApplied ? "yes" : "no",
      r.bill_mode === "flat" ? "" : (o.rateCents / 100).toFixed(2),
      r.bill_mode === "flat" ? "" : (r.hourlyCents / 100).toFixed(2),
      csvSafe(r.materials.map((m) => `${m.desc} ${(m.cents / 100).toFixed(2)}`).join("; ")),
      r.bill_mode === "hourly_materials" ? (r.materialsCents / 100).toFixed(2) : "",
      r.bill_mode === "flat" && r.price_cents !== null ? (r.price_cents / 100).toFixed(2) : "",
      (r.cents / 100).toFixed(2),
      csvSafe(r.notes),
    ]);
  }
  rows.push([]);
  rows.push(["TOTAL", "", "", "", "", "", "", "", "", "", "", b.tot.actual, b.tot.billed, "", "", "", "", (b.tot.materials / 100).toFixed(2), "", (b.tot.cents / 100).toFixed(2), ""]);
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
