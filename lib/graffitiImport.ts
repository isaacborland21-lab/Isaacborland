// Importing tags from OLD invoices (the "Instance Reporting" sheet of the monthly invoice) into graffiti_history.
// Pure rules, no database: reading the columns, mapping the tag type, working out minutes, building the duplicate keys
// and checking what comes back from the browser. Used by the import API routes and the Trends route.

import { City, GRAFFITI_TYPES, LEGACY_TYPES, localDate } from "@/lib/graffiti";
import type { Cell, Sheet } from "@/lib/xlsxRead";

export type ImportRow = {
  /** The local day the crew logged the tag, "YYYY-MM-DD". */
  day: string;
  /** The intersection / address as written ("" when the invoice left it blank). */
  address: string;
  gtype: string;
  gtype_other: string | null;
  surface: string | null;
  chemical: string | null;
  notes: string | null;
  duration_min: number | null;
  /** Minutes after midnight the crew arrived (only used to tell two identical rows apart). */
  arrive_min: number | null;
  lat: number | null;
  lng: number | null;
};

export type ParsedRow = ImportRow & { file: string; line: number; warnings: string[] };
export type ParsedFile = {
  file: string;
  rows: ParsedRow[];
  /** Rows that could not be used at all, with the reason. */
  skipped: { file: string; line: number; why: string }[];
  /** Plain-language notes about the file (which sheet was read, columns that were not found ...). */
  notes: string[];
};

export const ALL_TYPES: readonly string[] = [...GRAFFITI_TYPES, ...LEGACY_TYPES];
export const MAX_ROWS = 4000;

const clean = (v: Cell | undefined, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

// ---------- dates and times ----------

const pad = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** An Excel date serial or typed text ("10/13/2026", "2026-10-13", "Oct 13, 2026") -> "YYYY-MM-DD", or null. */
export function parseDay(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!(v >= 36526 && v < 80000)) return null; // 2000-01-01 ...
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m && validYmd(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (validYmd(y, +m[1], +m[2])) return `${y}-${pad(+m[1])}-${pad(+m[2])}`;
    return null; // never guess day/month order
  }
  const t = Date.parse(`${s} 12:00 UTC`);
  if (!Number.isNaN(t) && /[a-z]{3}/i.test(s)) {
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

/** A time cell (Excel fraction of a day, or "10:49", "2:39 PM") -> minutes after midnight, or null. */
export function parseMinutes(v: Cell | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    const frac = v - Math.floor(v);
    if (v < 0 || !Number.isFinite(v)) return null;
    return Math.min(1439, Math.round(frac * 1440));
  }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(v.trim());
  if (!m) return null;
  let h = +m[1];
  const mi = +m[2];
  if (mi > 59) return null;
  const ap = m[3]?.[0]?.toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === "p" ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + mi;
}

/** Minutes on the job. Invoices often leave off AM/PM, so a negative gap is read as crossing 12 o'clock. */
export function minutesBetween(arrive: number | null, left: number | null): { min: number | null; warn: string | null } {
  if (arrive === null || left === null) return { min: null, warn: null };
  let d = left - arrive;
  if (d < 0) d += 720;
  if (d < 0 || d > 600) return { min: null, warn: "Times look wrong, minutes left blank" };
  return { min: d, warn: null };
}

// ---------- tag type ----------

/** Words on the invoice -> the tracker's tag types. Anything else is "Other" and keeps the words. */
export function mapType(raw: string | null): { gtype: string; other: string | null; known: boolean } {
  if (!raw) return { gtype: "other", other: null, known: true };
  const s = raw.toLowerCase();
  if (/slap|sticker|decal|label/.test(s)) return { gtype: "slap", other: null, known: true };
  if (/chalk|sharpie|marker|crayon|\bpen\b|permanent/.test(s)) return { gtype: "chalk", other: null, known: true };
  if (/spray|aerosol|paint/.test(s)) return { gtype: "spray", other: null, known: true };
  if (/flyer|flier|poster|tattered|handbill/.test(s)) return { gtype: "flyer", other: null, known: true };
  return { gtype: "other", other: raw.slice(0, 60), known: /^other$/i.test(raw) };
}

// ---------- finding the columns ----------

type Field = "day" | "address" | "surface" | "type" | "arrive" | "left" | "chemical" | "notes";
const norm = (v: Cell) => String(v ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const MATCH: Record<Field, RegExp> = {
  day: /^(date|day)\b/,
  address: /intersection|street|location|address|where/,
  surface: /surface|material|substrate/,
  type: /\btype\b|\bkind\b/,
  arrive: /\bari?ved?\b|\barriv|\bstart|time in\b|\bbegin/,
  left: /\bleft\b|depart|finish|time out\b|\bend\b|\bstop/,
  chemical: /chemical|product|remover|solvent/,
  notes: /note|comment/,
};
const ORDER: Field[] = ["day", "address", "surface", "type", "arrive", "left", "chemical", "notes"];

export function findColumns(rows: Cell[][]): { header: number; cols: Partial<Record<Field, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = rows[r] ?? [];
    const cols: Partial<Record<Field, number>> = {};
    const used = new Set<number>();
    for (const f of ORDER) {
      for (let c = 0; c < cells.length; c++) {
        if (used.has(c) || cells[c] === null || cells[c] === undefined) continue;
        const h = norm(cells[c]);
        if (h && MATCH[f].test(h) && !(f === "type" && /surface|material/.test(h)) && !(f === "address" && /^date/.test(h))) {
          cols[f] = c;
          used.add(c);
          break;
        }
      }
    }
    if (cols.day !== undefined && cols.address !== undefined) return { header: r, cols };
  }
  return null;
}

// ---------- reading a whole file ----------

export function parseSheets(file: string, sheets: Sheet[], todayYmd: string): ParsedFile {
  const out: ParsedFile = { file, rows: [], skipped: [], notes: [] };
  const hits = sheets.map((s) => ({ s, f: findColumns(s.rows) })).filter((x) => x.f);
  if (hits.length === 0) {
    out.notes.push('No tag list found. The file needs a header row with at least "Date" and "Street Intersection" (or Location / Address) columns, like the "Instance Reporting" sheet of your invoice.');
    return out;
  }
  // an invoice workbook has other sheets (the invoice itself); only the ones with the tag columns are read
  for (const { s, f } of hits) {
    const { header, cols } = f!;
    const missing = (["surface", "type", "arrive", "left", "chemical"] as Field[]).filter((k) => cols[k] === undefined);
    out.notes.push(`${s.name === "CSV" ? "Read the file" : `Read sheet "${s.name}"`} (header on row ${header + 1}).${missing.length ? ` Columns not found: ${missing.join(", ")}.` : ""}`);
    const get = (row: Cell[], f: Field) => (cols[f] === undefined ? null : row[cols[f]!] ?? null);
    for (let r = header + 1; r < s.rows.length; r++) {
      const row = s.rows[r] ?? [];
      const dayRaw = get(row, "day");
      const addr = clean(get(row, "address"));
      if (dayRaw === null && !addr) continue; // blank row
      const line = r + 1;
      const day = parseDay(dayRaw);
      if (!day) {
        out.skipped.push({ file, line, why: dayRaw === null ? "No date" : `Could not read the date "${String(dayRaw).slice(0, 20)}"` });
        continue;
      }
      if (day > todayYmd) {
        out.skipped.push({ file, line, why: `Date ${day} is in the future` });
        continue;
      }
      const warnings: string[] = [];
      if (!addr) warnings.push("No location (still counted, but not placed on a street)");
      const typeRaw = clean(get(row, "type"), 80);
      const t = mapType(typeRaw);
      if (typeRaw && !t.known) warnings.push(`Tag type "${typeRaw.slice(0, 30)}" is not one of your types, counted as Other`);
      const arrive = parseMinutes(get(row, "arrive"));
      const left = parseMinutes(get(row, "left"));
      const dur = minutesBetween(arrive, left);
      if (dur.warn) warnings.push(dur.warn);
      out.rows.push({
        file,
        line,
        day,
        address: addr ?? "",
        gtype: t.gtype,
        gtype_other: t.other,
        surface: clean(get(row, "surface"), 80),
        chemical: clean(get(row, "chemical"), 80),
        notes: clean(get(row, "notes"), 300),
        duration_min: dur.min,
        arrive_min: arrive,
        lat: null,
        lng: null,
        warnings,
      });
      if (out.rows.length > MAX_ROWS) {
        out.notes.push(`More than ${MAX_ROWS} rows: stopped reading. Split the file.`);
        return out;
      }
    }
  }
  return out;
}

// ---------- duplicates ----------

/** "Main & N Rouse " and "main  &  n. rouse" are the same place. */
export const normAddr = (a: string) => a.toLowerCase().replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * One key per row, so importing the same file again changes nothing. Two truly identical rows in one file
 * (same day, place, type and arrival minute) get a counter so both are kept.
 */
export function dedupeKeys(city: City, rows: Pick<ImportRow, "day" | "address" | "gtype" | "arrive_min">[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${city}|${r.day}|${normAddr(r.address)}|${r.gtype}|${r.arrive_min ?? ""}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}|${n}`;
  });
}

// ---------- checking what the browser sends back ----------

/** A rough box around each city; a looked-up position outside it is thrown away rather than trusted. */
const BOX: Record<City, { lat: [number, number]; lng: [number, number] }> = {
  bozeman: { lat: [45.6, 45.76], lng: [-111.17, -110.93] },
  helena: { lat: [46.52, 46.68], lng: [-112.17, -111.9] },
};
export const cityBox = (c: City) => BOX[c];
export const inCityBox = (c: City, lat: number, lng: number) => lat >= BOX[c].lat[0] && lat <= BOX[c].lat[1] && lng >= BOX[c].lng[0] && lng <= BOX[c].lng[1];

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

export type CleanRow = ImportRow & { geo: "none" | "found" };

export function cleanRow(v: unknown, city: City, todayYmd: string): { ok: true; row: CleanRow } | { ok: false; error: string } {
  if (!v || typeof v !== "object") return { ok: false, error: "Bad row." };
  const o = v as Record<string, unknown>;
  const day = typeof o.day === "string" ? parseDay(o.day) : null;
  if (!day || day < "2000-01-01" || day > todayYmd) return { ok: false, error: "Bad date." };
  const gtype = typeof o.gtype === "string" && ALL_TYPES.includes(o.gtype) ? o.gtype : null;
  if (!gtype) return { ok: false, error: "Bad tag type." };
  const dur = o.duration_min === null || o.duration_min === undefined ? null : Number(o.duration_min);
  if (dur !== null && !(Number.isInteger(dur) && dur >= 0 && dur <= 1440)) return { ok: false, error: "Bad minutes." };
  const arrive = o.arrive_min === null || o.arrive_min === undefined ? null : Number(o.arrive_min);
  if (arrive !== null && !(Number.isInteger(arrive) && arrive >= 0 && arrive < 1440)) return { ok: false, error: "Bad arrival time." };
  let lat: number | null = null;
  let lng: number | null = null;
  if (o.lat !== null && o.lat !== undefined && o.lng !== null && o.lng !== undefined) {
    const a = Number(o.lat);
    const b = Number(o.lng);
    if (Number.isFinite(a) && Number.isFinite(b) && inCityBox(city, a, b)) {
      lat = Math.round(a * 1e6) / 1e6;
      lng = Math.round(b * 1e6) / 1e6;
    }
  }
  return {
    ok: true,
    row: {
      day,
      address: text(o.address, 200) ?? "",
      gtype,
      gtype_other: text(o.gtype_other, 60),
      surface: text(o.surface, 80),
      chemical: text(o.chemical, 80),
      notes: text(o.notes, 300),
      duration_min: dur,
      arrive_min: arrive,
      lat,
      lng,
      geo: lat !== null ? "found" : "none",
    },
  };
}

// ---------- for the Trends page ----------

/** 12:00 noon on a local day, as an ISO time (so the day it lands on never shifts with the time zone). */
export function localNoonIso(day: string, tz: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 12);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const asUtc = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second"));
  const iso = new Date(guess - (asUtc - guess)).toISOString();
  return localDate(iso, tz) === day ? iso : new Date(guess).toISOString();
}
