// Builds the monthly invoice as an .xlsx that looks exactly like the owner's own
// invoice template (a Google Sheets export with two tabs: "Invoice Sheet" and
// "Instance Reporting"). Google Sheets opens it as-is.
//
// How it works: the template file is opened as a zip and only the cell data is
// rewritten. The logo, fonts, borders, column widths, print setup and every cell of
// the letterhead stay byte-for-byte what the template has, so it cannot drift.
//
//  - "Instance Reporting" gets one row per finished job (the same columns the owner
//    types by hand today, plus "Done by").
//  - "Invoice Sheet" keeps the template's own formulas (quantity from the arrive/leave
//    times, rate, amount), as one list of every tag removed, oldest first, with the template's own total.
//
// Pure functions over a Buffer: no database, no network. The template itself is NOT in the
// source code (the repo is public): the owner uploads it once and it is read from storage.

import JSZip from "jszip";
import { InvoiceBuild, InvoiceLine, chemicalOf, localParts, typeText } from "@/lib/graffiti";

const SHEET_INVOICE = "xl/worksheets/sheet1.xml";
const SHEET_LOG = "xl/worksheets/sheet2.xml";
const STYLES = "xl/styles.xml";
const WORKBOOK = "xl/workbook.xml";
const LOG = "'Instance Reporting'";

/** The template is a fixed design: the first line row, the closing row and the footer start where they do here. */
const FIRST_LINE = 17;
const TEMPLATE_CLOSE_ROW = 94; // bottom border of the lines box; footer rows follow from 95
const MIN_TABLE_ROWS = TEMPLATE_CLOSE_ROW - FIRST_LINE + 1; // 78 rows even when there are few jobs
const FOOTER_FIRST = 95;
const LOG_FIRST = 4;
const LOG_MIN_LAST = 81;

export type InvoiceXlsxOptions = {
  /** Local date shown in the Date box, YYYY-MM-DD. */
  invoiceDate: string;
  invoiceNo: string;
  poNumber: string;
  terms: string;
  /** Replaces the template's Bill To block when given (one entry per line, up to 5). */
  billTo: string[];
  rateCents: number;
  tz: string;
};

// ---------- tiny XML helpers ----------

const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const colLetters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
const ref = (col: number, row: number) => `${colLetters[col]}${row}`;

const text = (r: string, s: number, v: string) =>
  v === "" ? `<c r="${r}" s="${s}"/>` : `<c r="${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
const num = (r: string, s: number, v: number) => `<c r="${r}" s="${s}"><v>${v}</v></c>`;
const blank = (r: string, s: number) => `<c r="${r}" s="${s}"/>`;
const fnum = (r: string, s: number, f: string, v: number | "") =>
  v === "" ? `<c r="${r}" s="${s}" t="str"><f>${esc(f)}</f><v></v></c>` : `<c r="${r}" s="${s}"><f>${esc(f)}</f><v>${v}</v></c>`;
const fstr = (r: string, s: number, f: string, v: string) => `<c r="${r}" s="${s}" t="str"><f>${esc(f)}</f><v>${esc(v)}</v></c>`;
const row = (n: number, cells: string[]) => `<row r="${n}">${cells.join("")}</row>`;

/** Days since 1899-12-30, the spreadsheet date number for a local YYYY-MM-DD. */
export function dateSerial(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
}

/** Spreadsheet WEEKNUM(date) with its default (weeks start on Sunday, week 1 holds Jan 1). */
export function weekNum(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const jan1 = new Date(Date.UTC(y, 0, 1)).getUTCDay();
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
  return Math.floor((dayOfYear + jan1) / 7) + 1;
}

/** Same arithmetic as the template's quantity formula: hours, rounded to the nearest half hour after adding 0.2499. */
export function templateQty(arrivedFrac: number, leftFrac: number): number {
  let diff = leftFrac - arrivedFrac;
  diff -= Math.floor(diff); // MOD(diff, 1)
  const x = 24 * diff + 0.2499;
  return Math.round(x / 0.5) * 0.5;
}

// ---------- jobs -> rows ----------

type Job = {
  line: InvoiceLine;
  logRow: number;
  date: string; // local YYYY-MM-DD
  arrived: number; // fraction of a day
  left: number;
  minutes: number;
  place: string;
  note: string;
};

const clock = (iso: string, tz: string) => {
  const p = localParts(iso, tz);
  return (Number(p.h) * 60 + Number(p.mi)) / 1440;
};

function toJobs(lines: InvoiceLine[], tz: string): Job[] {
  return lines.map((line, i) => {
    // Time left = when the job was finished; Time arrived = that minus the minutes worked, so the
    // template's own formula bills exactly what the app bills (no time recorded = the minimum).
    const minutes = line.actual ?? line.billed;
    const leftMin = Math.round(clock(line.finished_at ?? line.removed_at, tz) * 1440);
    const arrivedMin = (((leftMin - minutes) % 1440) + 1440) % 1440;
    const note = [line.notes?.trim() ?? "", line.actual === null ? "No time recorded: billed at the minimum." : ""].filter(Boolean).join(" ");
    return {
      line,
      logRow: LOG_FIRST + i,
      date: line.day,
      arrived: arrivedMin / 1440,
      left: (leftMin % 1440) / 1440,
      minutes,
      place: line.address?.trim() || `${line.lat}, ${line.lng}`,
      note,
    };
  });
}

// ---------- template access ----------

type Rows = Map<number, string>;

function splitSheet(xml: string): { head: string; rows: Rows; tail: string } {
  const a = xml.indexOf("<sheetData>");
  const b = xml.indexOf("</sheetData>");
  if (a < 0 || b < 0) throw new Error("The invoice template is not in the expected format (no sheet data).");
  const body = xml.slice(a + "<sheetData>".length, b);
  const rows: Rows = new Map();
  for (const m of body.matchAll(/<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) rows.set(Number(m[1]), m[0]);
  return { head: xml.slice(0, a), rows, tail: xml.slice(b + "</sheetData>".length) };
}

function shiftRow(rowXml: string, from: number, to: number): string {
  return rowXml
    .replace(new RegExp(`<row r="${from}"`), `<row r="${to}"`)
    .replace(new RegExp(`(<c r="[A-Z]+)${from}"`, "g"), `$1${to}"`);
}

export function checkTemplate(zip: JSZip, inv: string, log: string) {
  const need = [SHEET_INVOICE, SHEET_LOG, STYLES, WORKBOOK];
  for (const n of need) if (!zip.file(n)) throw new Error(`The invoice template is missing ${n}. Upload the invoice spreadsheet saved as .xlsx.`);
  if (!/Instance Reporting/.test(inv) || !/MROUND/.test(inv)) throw new Error("This doesn't look like your invoice template (the Invoice Sheet formulas are missing).");
  if (!/<row r="94"/.test(inv) || !/<row r="95"/.test(inv)) throw new Error("This doesn't look like your invoice template (the footer rows are missing).");
  if (!/<row r="4"/.test(log) || !/<row r="83"/.test(log)) throw new Error("This doesn't look like your template's Instance Reporting tab.");
}

// ---------- the build ----------

export async function buildInvoiceXlsx(templateBytes: Uint8Array | Buffer, build: InvoiceBuild, o: InvoiceXlsxOptions): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(templateBytes);
  const invXml = await zip.file(SHEET_INVOICE)?.async("string");
  const logXml = await zip.file(SHEET_LOG)?.async("string");
  if (!invXml || !logXml) throw new Error("The invoice template is missing its sheets.");
  checkTemplate(zip, invXml, logXml);

  const rate = o.rateCents / 100;
  const chemCount = build.lines.filter((l) => l.chem !== null).length;
  // The log keeps jobs in the order they were finished; the invoice sheet lists them in that same order, pointing at their log rows.
  const jobs = toJobs(build.lines, o.tz);
  const jobByLine = new Map(jobs.map((j) => [j.line.id, j]));
  if (jobs.length === 0) throw new Error("There are no finished jobs in that month.");

  // ---------- Instance Reporting (the log) ----------
  const log = splitSheet(logXml);
  const lastLog = Math.max(LOG_MIN_LAST, LOG_FIRST + jobs.length - 1);
  const firstDate = jobs[0].date;
  const b2 = Number(firstDate.slice(0, 4)) * 10000 + weekNum(firstDate) * 100;
  const logRows: string[] = [];
  // rows 1-3 come from the template; row 2 gets its cached value, row 3 gains the "Done by" header
  logRows.push(log.rows.get(1) ?? "");
  logRows.push(
    (log.rows.get(2) ?? "").replace(/<c r="B2"([^>]*)>(<f>[\s\S]*?<\/f>)<v>[^<]*<\/v>/, `<c r="B2"$1>$2<v>${b2}</v>`),
  );
  logRows.push((log.rows.get(3) ?? "").replace("</row>", `${text("K3", 5, "Done by")}</row>`));
  for (let r = LOG_FIRST; r <= lastLog; r++) {
    const j = jobs[r - LOG_FIRST];
    const prev = r === LOG_FIRST ? "1" : `A${r - 1}+1`;
    if (!j) {
      logRows.push(
        row(r, [
          fstr(ref(0, r), 6, `if(C${r}="","", ${prev})`, ""),
          fstr(ref(1, r), 7, `if(C${r}="","",B$2+A${r} & "-I")`, ""),
          blank(ref(2, r), 9),
          blank(ref(6, r), 12),
          blank(ref(7, r), 12),
        ]),
      );
      continue;
    }
    const n = r - LOG_FIRST + 1;
    logRows.push(
      row(r, [
        fnum(ref(0, r), 6, `if(C${r}="","", ${prev})`, n),
        fstr(ref(1, r), 7, `if(C${r}="","",B$2+A${r} & "-I")`, String(b2 + n) + "-I"),
        num(ref(2, r), 9, dateSerial(j.date)),
        text(ref(3, r), 1, j.place),
        text(ref(4, r), 1, j.line.surface?.trim() ?? ""),
        text(ref(5, r), 1, typeText(j.line.type, j.line.gtype_other)),
        num(ref(6, r), 12, j.arrived),
        num(ref(7, r), 12, j.left),
        text(ref(8, r), 1, chemicalOf(j.line)),
        text(ref(9, r), 1, j.note),
        text(ref(10, r), 1, j.line.person),
      ]),
    );
  }
  // spare row, then the black "START A NEW TRACKER" bar (moved down when there are more than 78 jobs)
  logRows.push(shiftRow(log.rows.get(82) ?? "", 82, lastLog + 1));
  const bar = shiftRow(log.rows.get(83) ?? "", 83, lastLog + 2).replace(/([A-Z])83\b/g, `$1${lastLog + 2}`);
  logRows.push(bar);
  const logHead = log.head.replace(/(<col customWidth="1" min="10" max="10" width="[\d.]+"\/>)/, `$1<col customWidth="1" min="11" max="11" width="18"/>`);
  const newLog = logHead + "<sheetData>" + logRows.join("") + "</sheetData>" + log.tail;

  // ---------- Invoice Sheet ----------
  const inv = splitSheet(invXml);
  // one row per tag, plus a row of its own under each tag that has a chemical bill-back, plus the closing row
  const tableRows = Math.max(MIN_TABLE_ROWS, jobs.length + chemCount + 1);
  const closeRow = FIRST_LINE + tableRows - 1;
  const footerFirst = closeRow + 1;
  const offset = footerFirst - FOOTER_FIRST;

  const out: string[] = [];
  // header block rows 1-16 are the template's; fill in date, number, PO, terms and (optionally) Bill To
  for (let r = 1; r < FIRST_LINE; r++) {
    let x = inv.rows.get(r) ?? "";
    if (r === 10) {
      x = x.replace(/<c r="H10" s="21">[\s\S]*?<\/c>/, `<c r="H10" s="21"><v>${dateSerial(o.invoiceDate)}</v></c>`);
      x = x.replace('<c r="I10" s="22"/>', text("I10", 22, o.invoiceNo));
    }
    if (r === 13) {
      if (o.poNumber.trim() !== "") x = x.replace('<c r="H13" s="25"/>', text("H13", 25, o.poNumber.trim()));
      if (o.terms.trim() !== "") x = x.replace(/<c r="I13" s="22" t="s"><v>\d+<\/v><\/c>/, text("I13", 22, o.terms.trim()));
    }
    if (o.billTo.length > 0 && r >= 10 && r <= 14) {
      const line = o.billTo[r - 10] ?? "";
      const s = r <= 12 ? 19 : 24;
      x = x.replace(new RegExp(`<c r="B${r}" s="${s}"(?: t="s"><v>\\d+</v></c>|/>)`), text(`B${r}`, s, line));
    }
    out.push(x);
  }

  // line rows
  const emptyLine = (r: number) =>
    row(r, [blank(ref(1, r), 35), blank(ref(2, r), 36), blank(ref(6, r), 20), blank(ref(7, r), 37), blank(ref(8, r), 40)]);
  const merges: string[] = [];
  let r = FIRST_LINE;
  let grand = 0;
  for (const j of jobs) {
    const lr = j.logRow;
    const qty = templateQty(j.arrived, j.left);
    const kind = typeText(j.line.type, j.line.gtype_other);
    const surf = j.line.surface?.trim() ?? "";
    const desc = `Graffiti Removal at ${j.place}${kind ? `, ${kind}` : ""}${surf ? ` on ${surf}` : ""}`;
    grand += qty * rate;
    out.push(
      row(r, [
        fnum(ref(1, r), 35, `if(${LOG}!G${lr}="","",MROUND((24*MOD(${LOG}!H${lr}-${LOG}!G${lr},1))+0.2499,0.5))`, qty),
        fstr(
          ref(2, r),
          36,
          // the template's description, but a missing kind or surface leaves no dangling ", " / " on "
          `if(${LOG}!D${lr}="","",CONCATENATE("Graffiti Removal at"," ",${LOG}!D${lr},if(${LOG}!F${lr}="","",", "&${LOG}!F${lr}),if(${LOG}!E${lr}="",""," on "&${LOG}!E${lr})))`,
          desc,
        ),
        blank(ref(6, r), 20),
        fnum(ref(7, r), 37, `if(B${r}="","",${rate})`, rate),
        fnum(ref(8, r), 40, `if(B${r}="","",H${r}*B${r})`, qty * rate),
      ]),
    );
    merges.push(`C${r}:G${r}`);
    r++;
    // the chemical bill-back is its own line item right under the tag: gallons x the price per gallon
    const chem = j.line.chem;
    if (chem) {
      const price = chem.unitCents / 100;
      grand += chem.gallons * price;
      out.push(
        row(r, [
          num(ref(1, r), 35, chem.gallons),
          text(ref(2, r), 36, `Chemical bill back: ${chem.label}, ${chem.gallons} gal at ${j.place}`),
          blank(ref(6, r), 20),
          num(ref(7, r), 37, price),
          fnum(ref(8, r), 40, `if(B${r}="","",H${r}*B${r})`, Math.round(chem.gallons * chem.unitCents) / 100),
        ]),
      );
      merges.push(`C${r}:G${r}`);
      r++;
    }
  }
  for (; r < closeRow; r++) {
    out.push(emptyLine(r));
    merges.push(`C${r}:G${r}`);
  }
  // closing row (bottom border), then the footer rows 95.. of the template moved down
  out.push(inv.rows.get(TEMPLATE_CLOSE_ROW) ? shiftRow(inv.rows.get(TEMPLATE_CLOSE_ROW) as string, TEMPLATE_CLOSE_ROW, closeRow) : "");
  merges.push(`C${closeRow}:G${closeRow}`);
  const lastTemplateRow = Math.max(...inv.rows.keys());
  for (let t = FOOTER_FIRST; t <= lastTemplateRow; t++) {
    const src = inv.rows.get(t);
    if (!src) continue;
    let x = shiftRow(src, t, t + offset);
    if (t === FOOTER_FIRST) {
      // the total adds up every line of the one list (work and chemical bill-back lines)
      x = x.replace(/<c r="I\d+" s="52"><f>[\s\S]*?<\/f><v>[^<]*<\/v><\/c>/, fnum(`I${t + offset}`, 52, `SUM(I${FIRST_LINE}:I${closeRow - 1})`, grand));
    }
    out.push(x);
  }
  const footMerges = [
    ...Array.from({ length: 8 }, (_, i) => `B${footerFirst + i}:G${footerFirst + i}`),
    `H${footerFirst}:H${footerFirst + 1}`,
    `I${footerFirst}:I${footerFirst + 1}`,
    `H${footerFirst + 2}:I${footerFirst + 3}`,
  ];

  // merge list: keep the template's header merges (rows 9-16), replace everything below
  const headerMerges = [...inv.tail.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)]
    .filter((m) => Number(m[4]) < FIRST_LINE)
    .map((m) => m[0].replace(/<mergeCell ref="|"\/>/g, ""));
  const allMerges = [...headerMerges, ...merges, ...footMerges];
  const mergeXml = `<mergeCells count="${allMerges.length}">${allMerges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`;
  const newTail = inv.tail.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, mergeXml);
  const newInv = inv.head + "<sheetData>" + out.join("") + "</sheetData>" + newTail;

  // ---------- write the package ----------
  zip.file(SHEET_INVOICE, newInv);
  zip.file(SHEET_LOG, newLog);
  const wb = (await zip.file(WORKBOOK)?.async("string")) as string;
  zip.file(WORKBOOK, wb.replace(/<calcPr\/>|<calcPr[^>]*\/>/, '<calcPr fullCalcOnLoad="1"/>'));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
