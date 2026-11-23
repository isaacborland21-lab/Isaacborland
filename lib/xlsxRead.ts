// A small, dependency-light reader for .xlsx (and .csv) files: just the cell values, as text or numbers.
// An .xlsx is a zip of XML files. We read the workbook's sheet list, the shared-strings table and each sheet's cells.
// Formulas are not calculated: Excel / Google Sheets save the last result next to the formula, and that is what we read.

import JSZip from "jszip";

export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_XML = 30 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unxml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? "";
  });
}

/** All the text inside the <t> elements of a chunk of XML (rich text is split over several of them). */
function textOf(xml: string): string {
  let out = "";
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] ? unxml(m[1]) : "";
  return out;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? unxml(m[1]) : null;
}

/** "C4" -> column index 2 */
function colIndex(ref: string): number {
  const m = /^([A-Z]+)/i.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path);
  if (!f) return null;
  const s = await f.async("string");
  if (s.length > MAX_XML) throw new Error("That spreadsheet is too big to read.");
  return s;
}

function parseSheetXml(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  let auto = 0;
  while ((rm = rowRe.exec(xml))) {
    const rAttr = attr(rm[1], "r");
    const rowNo = rAttr ? Number(rAttr) - 1 : auto;
    auto = rowNo + 1;
    if (!Number.isInteger(rowNo) || rowNo < 0 || rowNo > 20000) continue;
    const cells: Cell[] = [];
    const body = rm[2] ?? "";
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let nextCol = 0;
    while ((cm = cellRe.exec(body))) {
      const ref = attr(cm[1], "r");
      const col = ref ? colIndex(ref) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col > 200) continue;
      const t = attr(cm[1], "t");
      const inner = cm[2] ?? "";
      let value: Cell = null;
      if (t === "inlineStr") {
        value = textOf(inner);
      } else {
        const vm = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(inner);
        const raw = vm && vm[1] !== undefined ? unxml(vm[1]) : null;
        if (raw !== null) {
          if (t === "s") value = shared[Number(raw)] ?? null;
          else if (t === "str") value = raw;
          else if (t === "b") value = raw === "1" ? "TRUE" : "FALSE";
          else if (t === "e") value = null; // #N/A, #REF! ...
          else {
            const n = Number(raw);
            value = Number.isFinite(n) ? n : raw;
          }
        }
      }
      if (typeof value === "string" && value.trim() === "") value = null;
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    while (rows.length < rowNo) rows.push([]);
    rows[rowNo] = cells;
  }
  return rows;
}

export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  if (bytes.length > MAX_BYTES) throw new Error("That file is too big (limit 8 MB).");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("That does not look like an Excel (.xlsx) file.");
  }
  const wb = await readText(zip, "xl/workbook.xml");
  if (!wb) throw new Error("That does not look like an Excel (.xlsx) file.");
  const rels = (await readText(zip, "xl/_rels/workbook.xml.rels")) ?? "";
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) relTarget.set(id, target);
  }
  const sst = await readText(zip, "xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(m[1] ? textOf(m[1]) : "");

  const sheets: Sheet[] = [];
  let i = 0;
  for (const m of wb.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    i += 1;
    const name = attr(m[1], "name") ?? `Sheet${i}`;
    const rid = attr(m[1], "r:id");
    let target = rid ? relTarget.get(rid) ?? null : null;
    if (!target) target = `worksheets/sheet${i}.xml`;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = await readText(zip, path);
    if (xml) sheets.push({ name, rows: parseSheetXml(xml, shared) });
  }
  if (sheets.length === 0) throw new Error("No sheets found in that file.");
  return sheets;
}

/** A plain CSV (quotes, commas inside quotes, doubled quotes, CRLF). */
export function readCsv(text: string): Sheet {
  const src = text.replace(/^﻿/, "");
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cur = "";
  let q = false;
  const pushCell = () => {
    const v = cur.trim();
    row.push(v === "" ? null : v);
    cur = "";
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") pushCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      pushCell();
      rows.push(row);
      row = [];
    } else cur += c;
    if (rows.length > 20000) throw new Error("That file has too many rows.");
  }
  if (cur !== "" || row.length) {
    pushCell();
    rows.push(row);
  }
  return { name: "CSV", rows };
}

/** Reads an uploaded file: .xlsx (a zip) or .csv (text). */
export async function readSheets(bytes: Uint8Array): Promise<Sheet[]> {
  const zipMagic = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (zipMagic) return readXlsx(bytes);
  if (bytes.length > MAX_BYTES) throw new Error("That file is too big (limit 8 MB).");
  const text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("\u0000")) throw new Error("Use an Excel (.xlsx) or CSV file. Old .xls and PDF files can not be read.");
  return [readCsv(text)];
}
