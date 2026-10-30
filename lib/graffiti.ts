// Shared logic for the Graffiti tab: types, validation, the timer rules and
// the monthly invoice math. Pure functions only (no database, no React) so
// the browser, the API routes and the tests all use exactly the same rules.
//
// Times are stored as UTC timestamps. "Which month is a job in" and every
// date shown on an invoice use the time zone saved in the billing settings
// (default America/Denver), never the server's zone.

// ---------- Constants ----------

export const GRAFFITI_STATUSES = ["reported", "scheduled", "in_progress", "removed"] as const;
export type GraffitiStatus = (typeof GRAFFITI_STATUSES)[number];

// What crew can pick for a new tag.
export const GRAFFITI_TYPES = ["slap", "chalk", "sharpie", "spray", "other"] as const;
// Retired choices: no longer offered, but jobs already saved with them keep working.
export const LEGACY_TYPES = ["ssr", "powerwash"] as const;
export type GraffitiType = (typeof GRAFFITI_TYPES)[number] | (typeof LEGACY_TYPES)[number];
/** Every type that can appear on a saved job (pickable first, then retired ones). */
export const ALL_TYPES: readonly GraffitiType[] = [...GRAFFITI_TYPES, ...LEGACY_TYPES];

export const TYPE_NAMES: Record<GraffitiType, string> = {
  slap: "Slap tag",
  chalk: "Chalk pen",
  sharpie: "Sharpie",
  spray: "Spray paint",
  other: "Other",
  ssr: "SSR",
  powerwash: "Powerwash",
};

export const STATUS_LABEL: Record<GraffitiStatus, string> = {
  reported: "Reported",
  scheduled: "Scheduled",
  in_progress: "In progress",
  removed: "Removed",
};

// Pick-lists for the invoice description ("Graffiti Removal at <place>, <tag type> on <surface>").
// Crew can also type their own ("Other"), so the stored value is free text.
export const SURFACE_OPTIONS = [
  "Electrical box",
  "Brick wall",
  "Concrete",
  "Sign / signpost",
  "Utility pole",
  "Mailbox",
  "Trash can / dumpster",
  "Bench",
  "Bridge / underpass",
  "Building wall",
  "Other",
];
export const CHEMICAL_OPTIONS = ["SSR", "Bare brick", "Paint over", "Razor", "Other"];

export const MAX_MINUTES = 1440;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/** Extra photos (beyond as reported / before / after) one tag may hold. */
export const MAX_EXTRA_PHOTOS = 30;
export const PHOTO_NAME_RE = /^[a-f0-9]{32}\.jpg$/;

export function isStatus(v: unknown): v is GraffitiStatus {
  return typeof v === "string" && (GRAFFITI_STATUSES as readonly string[]).includes(v);
}
export function isType(v: unknown): v is GraffitiType {
  return typeof v === "string" && (ALL_TYPES as readonly string[]).includes(v);
}
/** A type crew may choose for a new tag (excludes the retired ones). */
export function isPickType(v: unknown): v is (typeof GRAFFITI_TYPES)[number] {
  return typeof v === "string" && (GRAFFITI_TYPES as readonly string[]).includes(v);
}
/** For lists and tables: "Other: wax pencil" when the crew typed what "Other" was. */
export function typeName(v: string | null | undefined, other?: string | null): string {
  const t = isType(v) ? v : "other";
  const o = (other ?? "").trim();
  return t === "other" && o ? `Other: ${o}` : TYPE_NAMES[t];
}
/** For the invoice line: what the tag was ("wax pencil" instead of "Other: wax pencil"). */
export function typeText(v: string | null | undefined, other?: string | null): string {
  const t = isType(v) ? v : "other";
  const o = (other ?? "").trim();
  return t === "other" && o ? o : TYPE_NAMES[t];
}

// ---------- Types ----------

/** An extra photo on a tag (any time, any status). The account id never leaves the server. */
export type IncidentPhoto = {
  id: number;
  name: string;
  /** when it was added (ISO) */
  at: string;
  by: string | null;
  /** added by the person looking at it (they may remove it) */
  mine: boolean;
};

/** One logged tag, as the browser sees it. */
export type Incident = {
  id: number;
  status: GraffitiStatus;
  lat: number;
  lng: number;
  address: string | null;
  gtype: GraffitiType;
  description: string | null;
  notes: string | null;
  before_photo: string | null;
  after_photo: string | null;
  reported_at: string;
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  removed_at: string | null;
  duration_min: number | null;
  /** Photo of the tag as first reported (separate from the remover's before/after photos). */
  report_photo: string | null;
  reported_by_name: string | null;
  urgent: boolean;
  /** Who said "I'll take this" (name only; the account id never leaves the server). */
  claimed_by_name: string | null;
  claimed_by_me?: boolean;
  mine?: boolean;
  /** For the invoice description and the log: kind of graffiti, what it was on, what removed it. */
  surface: string | null;
  chemical: string | null;
  /** What "Other" tag type meant, when the crew typed it. */
  gtype_other?: string | null;
  /** Whoever finished (or took) the job: the account that gets the credit on the invoice. */
  removed_by_name: string | null;
  /** Extra photos added to the tag (oldest first). Missing = none. */
  photos?: IncidentPhoto[];
};

/** Form fields that were actually sent (a key is present even if its value is ""). */
export type Fields = Record<string, string>;

export type Ok<T> = { ok: true } & T;
export type Fail = { ok: false; error: string };

// ---------- Small helpers ----------

export function clean(v: string | null | undefined, max: number): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s.slice(0, max);
}

/** Whole minutes 0..1440, or null when blank. */
export function parseMinutes(v: string | null | undefined): Ok<{ value: number | null }> | Fail {
  const s = (v ?? "").trim();
  if (s === "") return { ok: true, value: null };
  if (!/^-?\d+$/.test(s)) return { ok: false, error: "Time taken must be whole minutes (0 to 1440)" };
  const n = Number(s);
  if (n < 0 || n > MAX_MINUTES) return { ok: false, error: "Time taken must be whole minutes (0 to 1440)" };
  return { ok: true, value: n };
}

function parseCoord(v: string | undefined, limit: number): number | null {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return n;
}

/**
 * The moment a photo was taken (ms). The phone sends it as photo_at so a slow
 * upload on bad signal doesn't stretch the job. Anything in the future or
 * older than 12 hours is ignored and the server clock is used instead.
 */
export function photoTime(photoAt: string | undefined, nowMs: number): number {
  const s = (photoAt ?? "").trim();
  if (s === "") return nowMs;
  const n = Number(s);
  if (!Number.isFinite(n)) return nowMs;
  const c = Math.round(n);
  if (c >= nowMs - 12 * 3600_000 && c <= nowMs + 5 * 60_000) return Math.min(c, nowMs);
  return nowMs;
}

export function minutesBetween(startIso: string | null, endMs: number): number | null {
  if (!startIso) return null;
  const s = Date.parse(startIso);
  if (Number.isNaN(s)) return null;
  return Math.max(1, Math.round((endMs - s) / 60_000));
}

const iso = (ms: number) => new Date(ms).toISOString();

/** A checkbox-style form value: "1", "true" or "on" means yes. */
const flag = (v: string | undefined) => ["1", "true", "on"].includes((v ?? "").trim().toLowerCase());

// ---------- Create ----------

export type NewIncident = {
  status: GraffitiStatus;
  lat: number;
  lng: number;
  address: string | null;
  gtype: GraffitiType;
  description: string | null;
  reported_at: string;
  started_at: string | null;
  finished_at: string | null;
  removed_at: string | null;
  duration_min: number | null;
  urgent: boolean;
  surface: string | null;
  chemical: string | null;
  gtype_other: string | null;
};

/**
 * mode "start":  before photo taken, clock starts at the photo time.
 * mode "report": spotted, no work yet.
 * mode "done":   already finished (minutes typed in).
 */
/** The tag details the crew must fill in before any photo is taken (chemical only once someone is actually removing it). */
export const DETAIL_LABELS = { surface: "what it's on", chemical: "the chemical used" } as const;

/** Names of the required details that are still blank, in form order. */
export function missingDetails(v: { surface?: string | null; chemical?: string | null }, needChemical: boolean): string[] {
  const out: string[] = [];
  if (!(v.surface ?? "").trim()) out.push(DETAIL_LABELS.surface);
  if (needChemical && !(v.chemical ?? "").trim()) out.push(DETAIL_LABELS.chemical);
  return out;
}

export function detailsMessage(missing: string[]): string {
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}` : missing[0];
  return `Fill in ${list} first.`;
}

export function computeCreate(fields: Fields, nowMs: number): Ok<{ row: NewIncident }> | Fail {
  const lat = parseCoord(fields.lat, 90);
  const lng = parseCoord(fields.lng, 180);
  if (lat === null || lng === null) return { ok: false, error: "Pick a location on the map or use GPS" };

  const gtype: GraffitiType = isPickType(fields.gtype) ? fields.gtype : "other";
  const mode = fields.mode === "start" || fields.mode === "done" ? fields.mode : "report";
  const lacking = missingDetails({ surface: fields.surface, chemical: fields.chemical }, mode !== "report");
  if (lacking.length > 0) return { ok: false, error: detailsMessage(lacking) };

  let status: GraffitiStatus = "reported";
  let started: string | null = null;
  let finished: string | null = null;
  let removed: string | null = null;
  let duration: number | null = null;
  if (mode === "start") {
    status = "in_progress";
    started = iso(photoTime(fields.photo_at, nowMs));
  } else if (mode === "done") {
    status = "removed";
    finished = removed = iso(nowMs);
    const m = parseMinutes(fields.duration_min);
    if (!m.ok) return m;
    duration = m.value;
  }

  return {
    ok: true,
    row: {
      status,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      address: clean(fields.address, 255),
      gtype,
      gtype_other: gtype === "other" ? clean(fields.gtype_other, 60) : null,
      description: clean(fields.description, 2000),
      reported_at: started ?? iso(nowMs),
      started_at: started,
      finished_at: finished,
      removed_at: removed,
      duration_min: duration,
      urgent: false, // the Urgent option was removed from reporting; a new tag is never urgent
      surface: clean(fields.surface, 80),
      chemical: clean(fields.chemical, 80),
    },
  };
}

// ---------- Update ----------

export type CurrentIncident = {
  status: GraffitiStatus;
  started_at: string | null;
  finished_at: string | null;
  removed_at: string | null;
  /** needed so starting / finishing can check the required details; absent = treated as blank */
  surface?: string | null;
  chemical?: string | null;
};

export type IncidentPatch = Partial<{
  status: GraffitiStatus;
  gtype: GraffitiType;
  address: string | null;
  notes: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  finished_at: string | null;
  removed_at: string | null;
  duration_min: number | null;
  urgent: boolean;
  surface: string | null;
  chemical: string | null;
  gtype_other: string | null;
  /** "me" = I'll take this, "release" = give it back. The route turns this into the claimed_by columns. */
  claim: "me" | "release";
}>;

/**
 * Works out what an update changes. `act` is the one-tap action from the
 * photo buttons: "start" (before photo) or "finish" (after photo).
 *  - starting stamps started_at with the before-photo time (first start only)
 *  - finishing stamps the finish with the after-photo time and, unless minutes
 *    were typed, sets the time on site from the two photo times
 *  - moving back to reported/scheduled clears the work-in-progress data
 *  - reopening a finished job (In progress) keeps its finish time and minutes; marking it Removed again
 *    without a new after photo restores them (a mis-tap can't inflate the time). A new after photo re-times it.
 * `hasNewPhoto` only matters for the "nothing to update" check.
 */
export function computeUpdate(
  row: CurrentIncident,
  fields: Fields,
  nowMs: number,
  hasNewPhoto: boolean,
): Ok<{ patch: IncidentPatch }> | Fail {
  const patch: IncidentPatch = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(fields, k);

  let status: string | null = has("status") ? fields.status : null;
  if (fields.act === "start") status = "in_progress";
  else if (fields.act === "finish") status = "removed";

  let durationGiven = has("duration_min");
  let durationVal: number | null = null;
  if (durationGiven) {
    const m = parseMinutes(fields.duration_min);
    if (!m.ok) return m;
    durationVal = m.value;
  }

  if (status !== null) {
    if (!isStatus(status)) return { ok: false, error: "Bad status" };
    patch.status = status;
    if (status === "in_progress") {
      if (row.started_at === null) patch.started_at = iso(photoTime(fields.photo_at, nowMs));
      if (row.status === "removed") {
        // Reopening a finished job (often a mis-tap) keeps its finish time and minutes, so tapping
        // "Removed" again puts it back exactly as it was. Only a new after photo re-times it.
        patch.removed_at = null;
        durationGiven = false;
      } else {
        patch.finished_at = null;
        patch.removed_at = null;
        // a fresh start ignores any typed time
        durationGiven = false;
      }
      durationVal = null;
    } else if (status === "removed") {
      const newAfter = fields.act === "finish" && hasNewPhoto;
      if (!newAfter && row.status !== "removed" && row.finished_at !== null) {
        // back to Removed after a reopen, with no new after photo: restore the original finish (and keep its minutes)
        patch.removed_at = row.finished_at;
      } else {
        // the clock stops when the after photo was taken (never before the job started)
        let finishMs = photoTime(fields.photo_at, nowMs);
        if (row.started_at !== null) {
          const startMs = Date.parse(row.started_at);
          if (!Number.isNaN(startMs)) finishMs = Math.max(finishMs, startMs);
        }
        const redo = newAfter && row.status !== "removed" && row.finished_at !== null;
        if (row.removed_at === null || redo) patch.removed_at = iso(finishMs);
        if (row.finished_at === null || redo) patch.finished_at = iso(finishMs);
        // time from the photos unless the crew typed a number
        if (row.status !== "removed" && !(durationGiven && durationVal !== null)) {
          const auto = minutesBetween(row.started_at, finishMs);
          if (auto !== null) {
            durationGiven = true;
            durationVal = Math.min(auto, MAX_MINUTES);
          }
        }
      }
    } else {
      // reported / scheduled: undo any work-in-progress data
      patch.started_at = null;
      patch.finished_at = null;
      patch.removed_at = null;
      patch.duration_min = null;
      durationGiven = false;
    }
  }
  if (durationGiven) patch.duration_min = durationVal;

  if (has("gtype")) {
    if (!isType(fields.gtype)) return { ok: false, error: "Bad tag type" };
    patch.gtype = fields.gtype;
    // switching to a real type drops any typed "Other" text
    if (fields.gtype !== "other") patch.gtype_other = null;
  }
  if (has("gtype_other") && !(patch.gtype !== undefined && patch.gtype !== "other")) patch.gtype_other = clean(fields.gtype_other, 60);
  if (has("address")) patch.address = clean(fields.address, 255);
  if (has("notes")) patch.notes = clean(fields.notes, 2000);
  if (has("scheduled_for")) {
    const d = (fields.scheduled_for ?? "").trim();
    if (d !== "" && !(/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)))) {
      return { ok: false, error: "Bad date" };
    }
    patch.scheduled_for = d === "" ? null : d;
  }

  // the Urgent option was removed: an old urgent flag can still be cleared, but nothing can be marked urgent
  if (has("urgent") && !flag(fields.urgent)) patch.urgent = false;
  if (has("surface")) patch.surface = clean(fields.surface, 80);
  if (has("chemical")) patch.chemical = clean(fields.chemical, 80);
  if (has("claim")) {
    if (fields.claim !== "me" && fields.claim !== "release") return { ok: false, error: "Bad claim" };
    patch.claim = fields.claim;
  }

  // starting or finishing the job needs the details (what the row already has, or what is being sent now)
  if (fields.act === "start" || fields.act === "finish") {
    const lacking = missingDetails(
      {
        surface: "surface" in patch ? patch.surface : row.surface,
        chemical: "chemical" in patch ? patch.chemical : row.chemical,
      },
      true,
    );
    if (lacking.length > 0) return { ok: false, error: detailsMessage(lacking) };
  }

  if (Object.keys(patch).length === 0 && !hasNewPhoto) return { ok: false, error: "Nothing to update" };
  return { ok: true, patch };
}

// ---------- Time zones ----------

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Parts = { y: string; mo: string; d: string; h: string; mi: string; s: string };

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function localParts(isoStr: string, tz: string): Parts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(isoStr))) out[p.type] = p.value;
  return { y: out.year, mo: out.month, d: out.day, h: out.hour === "24" ? "00" : out.hour, mi: out.minute, s: out.second };
}

export const localMonth = (isoStr: string, tz: string) => {
  const p = localParts(isoStr, tz);
  return `${p.y}-${p.mo}`;
};
export const localDate = (isoStr: string, tz: string) => {
  const p = localParts(isoStr, tz);
  return `${p.y}-${p.mo}-${p.d}`;
};
/** "2026-10-05 14:48:00" in the zone, for the CSV. */
export const localStamp = (isoStr: string, tz: string) => {
  const p = localParts(isoStr, tz);
  return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.s}`;
};

export function fmtShortDate(isoStr: string, tz: string): string {
  return new Date(isoStr).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
}
export function fmtLongDate(isoStr: string, tz: string): string {
  return new Date(isoStr).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" });
}
export function fmtClock(isoStr: string, tz: string): string {
  return new Date(isoStr).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}
/** "2026-10-17" (no zone) as "October 17, 2026". */
export function fmtPlainDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
export function monthLabel(month: string, long = true): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: long ? "long" : "short",
    year: "numeric",
  });
}
export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

// ---------- Invoice periods: a whole month, or any date range ----------

/** A real calendar date written YYYY-MM-DD. */
export const isDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const dayNumber = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
export const MAX_RANGE_DAYS = 366;
/** First and last day of a YYYY-MM month. */
export const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
};
export type DateRange = { from: string; to: string };
/** Checks a from/to pair (both inclusive, local days). */
export function checkRange(from: unknown, to: unknown): { ok: true; range: DateRange } | { ok: false; error: string } {
  if (!isDate(from) || !isDate(to)) return { ok: false, error: "Pick a valid start and end date." };
  if (from > to) return { ok: false, error: "The start date is after the end date." };
  if (dayNumber(to) - dayNumber(from) + 1 > MAX_RANGE_DAYS) return { ok: false, error: `A date range can be at most ${MAX_RANGE_DAYS} days.` };
  return { ok: true, range: { from, to } };
}
/** The days an invoice covers: its own date range, or its whole month. */
export function periodOf(p: { month: string; date_from?: string | null; date_to?: string | null }): DateRange {
  return p.date_from && p.date_to ? { from: p.date_from, to: p.date_to } : monthBounds(p.month);
}
/** The range of a sent invoice, or {} for a plain month invoice (so it can be spread into buildInvoice options). */
export const snapRange = (p: { date_from?: string | null; date_to?: string | null }): { from?: string; to?: string } =>
  p.date_from && p.date_to ? { from: p.date_from, to: p.date_to } : {};
/**
 * Reads the period a request asks for: a date range (from + to together) or a month (default: the current one).
 * `month` is the range's starting month for a range, so every invoice still belongs to a month.
 */
export function parsePeriod(
  q: { month?: unknown; from?: unknown; to?: unknown },
  currentMonth: string,
): { ok: true; month: string; range: DateRange | null } | { ok: false; error: string } {
  const has = (v: unknown) => v !== null && v !== undefined && v !== "";
  if (has(q.from) || has(q.to)) {
    if (!has(q.from) || !has(q.to)) return { ok: false, error: "Give both a start and an end date." };
    const c = checkRange(q.from, q.to);
    if (!c.ok) return c;
    return { ok: true, month: c.range.from.slice(0, 7), range: c.range };
  }
  if (!has(q.month)) return { ok: true, month: currentMonth, range: null };
  if (!isMonth(q.month)) return { ok: false, error: "Bad month (use YYYY-MM)." };
  return { ok: true, month: q.month, range: null };
}
export const rangesOverlap = (a: DateRange, b: DateRange) => a.from <= b.to && b.from <= a.to;
const compact = (ymd: string) => ymd.replace(/-/g, "");
/** "October 2026" for a month, or "Oct 15 - Nov 5, 2026" for a range. */
export function periodLabel(month: string, from?: string | null, to?: string | null, long = true): string {
  if (!from || !to) return monthLabel(month, long);
  const at = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const fmt = (d: Date, withYear: boolean) => d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  const f = at(from);
  const t = at(to);
  return `${fmt(f, f.getUTCFullYear() !== t.getUTCFullYear())} - ${fmt(t, true)}`;
}
/** INV-20261015-20261105-HEL for a date range (a -2, -3... is added if that number is taken). */
export function rangeInvoiceNo(city: City, from: string, to: string, taken: string[] = []): string {
  const base = `INV-${compact(from)}-${compact(to)}-${city.slice(0, 3).toUpperCase()}`;
  let n = 1;
  let no = base;
  while (taken.includes(no)) no = `${base}-${++n}`;
  return no;
}

// ---------- Money ----------

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const hours = (min: number) => `${(min / 60).toFixed(2)} h`;
export function fmtDur(min: number | null): string {
  if (min === null) return "";
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`;
}

// ---------- Billing settings ----------

export type BillingSettings = {
  biz_name: string;
  biz_address: string;
  biz_contact: string;
  bill_to: string; // Bozeman's invoices
  po_number: string;
  bill_to_helena: string;
  po_number_helena: string;
  rate: string; // dollars per hour
  min_minutes: string;
  round_to: string;
  terms: string;
  tz: string;
};

export const SETTING_DEFAULTS: BillingSettings = {
  biz_name: "",
  biz_address: "",
  biz_contact: "",
  bill_to: "",
  po_number: "",
  bill_to_helena: "",
  po_number_helena: "",
  rate: "0",
  min_minutes: "30",
  round_to: "1",
  terms: "Net 30",
  tz: "America/Denver",
};
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as (keyof BillingSettings)[];
export const ROUND_OPTIONS = [1, 5, 10, 15, 30, 60];

export function mergeSettings(rows: { k: string; v: string | null }[]): BillingSettings {
  const s: BillingSettings = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    if ((SETTING_KEYS as string[]).includes(r.k)) s[r.k as keyof BillingSettings] = r.v ?? "";
  }
  if (!isValidTimeZone(s.tz)) s.tz = SETTING_DEFAULTS.tz;
  return s;
}

/** Validates a settings form; anything invalid keeps its current value. */
export function sanitizeSettings(input: Record<string, unknown>, current: BillingSettings): BillingSettings {
  const str = (k: string, max: number) => String(input[k] ?? "").trim().slice(0, max);
  const next: BillingSettings = {
    biz_name: str("biz_name", 120),
    biz_address: str("biz_address", 400),
    biz_contact: str("biz_contact", 200),
    bill_to: str("bill_to", 400),
    po_number: str("po_number", 80),
    bill_to_helena: str("bill_to_helena", 400),
    po_number_helena: str("po_number_helena", 80),
    terms: str("terms", 200),
    rate: current.rate,
    min_minutes: current.min_minutes,
    round_to: "1",
    tz: current.tz,
  };
  const rate = Number(String(input.rate ?? "").trim());
  if (String(input.rate ?? "").trim() !== "" && Number.isFinite(rate) && rate >= 0 && rate <= 10000) {
    next.rate = String(Math.round(rate * 100) / 100);
  }
  const minRaw = String(input.min_minutes ?? "").trim();
  if (/^\d+$/.test(minRaw) && Number(minRaw) <= MAX_MINUTES) next.min_minutes = String(Number(minRaw));
  const rt = Number(input.round_to);
  next.round_to = ROUND_OPTIONS.includes(rt) ? String(rt) : "1";
  const tz = String(input.tz ?? "").trim();
  if (tz !== "" && isValidTimeZone(tz)) next.tz = tz;
  return next;
}

// ---------- Cities (Helena / Bozeman) ----------

export const CITIES = ["bozeman", "helena"] as const;
export type City = (typeof CITIES)[number];
export const CITY_NAMES: Record<City, string> = { bozeman: "Bozeman", helena: "Helena" };
const CITY_CENTERS: Record<City, [number, number]> = { bozeman: [45.677, -111.0386], helena: [46.5927, -112.0361] };
export function isCity(v: unknown): v is City {
  return typeof v === "string" && (CITIES as readonly string[]).includes(v);
}
/** Which city a pin belongs to: the closer of the two city centres (Belgrade, Hyalite etc. land on Bozeman; East Helena on Helena). */
export function autoCity(lat: number, lng: number): City {
  const d = (c: [number, number]) => (lat - c[0]) ** 2 + ((lng - c[1]) * Math.cos((lat * Math.PI) / 180)) ** 2;
  return d(CITY_CENTERS.helena) < d(CITY_CENTERS.bozeman) ? "helena" : "bozeman";
}
/** Each city is billed to its own department: the plain `bill_to` / `po_number` settings are Bozeman's. */
export const billToFor = (s: BillingSettings, c: City) => (c === "helena" ? s.bill_to_helena : s.bill_to);
export const poFor = (s: BillingSettings, c: City) => (c === "helena" ? s.po_number_helena : s.po_number);
/** The city on an invoice: the owner's override when there is one, else worked out from the pin. */
export function cityOf(r: { city?: string | null; lat: number; lng: number }): City {
  return isCity(r.city) ? r.city : autoCity(r.lat, r.lng);
}

// ---------- Invoice ----------

export type InvoiceRow = {
  id: number;
  gtype: string;
  address: string | null;
  notes: string | null;
  description: string | null;
  lat: number;
  lng: number;
  before_photo: string | null;
  after_photo: string | null;
  started_at: string | null;
  finished_at: string | null;
  removed_at: string;
  duration_min: number | null;
  surface: string | null;
  chemical: string | null;
  gtype_other?: string | null;
  /** Owner's city override ("bozeman" / "helena"); null = worked out from the pin. */
  city?: string | null;
  /** Name of the crew account that did the job (worked out on the server). Null = unknown. */
  done_by: string | null;
};

export const UNASSIGNED = "Unassigned";

export type InvoiceLine = InvoiceRow & {
  type: GraffitiType;
  actual: number | null; // real minutes on site, never changed by the minimum
  billed: number; // minutes billed (minimum / rounding applied)
  cents: number;
  minApplied: boolean;
  day: string; // local date finished, YYYY-MM-DD
  person: string; // who did it (UNASSIGNED when nobody is recorded)
  cityName: City; // Helena or Bozeman (override, else from the pin)
  cityAuto: City; // where the pin says it is
};

export type Totals = { jobs: number; actual: number; billed: number; cents: number };

export type PersonGroup = { name: string; lines: InvoiceLine[]; tot: Totals };

export type InvoiceBuild = {
  lines: InvoiceLine[];
  /** The same lines grouped by who did them (alphabetical, Unassigned last). */
  people: PersonGroup[];
  ids: number[];
  byType: Partial<Record<GraffitiType, Totals>>;
  tot: Totals;
  warn: { notime: number[]; noaddr: number[]; noafter: number[] }; // job ids
};

const emptyTotals = (): Totals => ({ jobs: 0, actual: 0, billed: 0, cents: 0 });

/** What one tag bills: the minimum applies per tag however short the job was. */
export function billTag(actual: number | null, minMin: number, roundTo: number, rateCents: number) {
  const step = Math.max(1, roundTo);
  const billed = actual === null ? minMin : Math.max(minMin, Math.ceil(actual / step) * step);
  return { billed, cents: Math.round((billed * rateCents) / 60), minApplied: actual === null || actual < minMin };
}

export const dollarsToCents = (rate: string) => Math.round((Number(rate) || 0) * 100);

/** An invoiced month keeps the rate / minimum / rounding it was sent with; other months use today's settings. */
export function billingFor(settings: BillingSettings, snap: Pick<InvoiceSnapshot, "rate_cents" | "min_minutes" | "round_to"> | null) {
  return {
    rateCents: snap ? snap.rate_cents : dollarsToCents(settings.rate),
    minMin: snap ? snap.min_minutes : Number(settings.min_minutes) || 0,
    roundTo: snap ? snap.round_to : Number(settings.round_to) || 1,
  };
}

/** Chemical used; older jobs only have the tag-type buttons, where "SSR" was the chemical. */
export const chemicalOf = (r: { chemical: string | null; gtype: string }) => r.chemical?.trim() || (r.gtype === "ssr" ? "SSR" : "");

/** INV-202610 (no city), INV-202610-HEL, INV-202610-HEL-2 for a second invoice the same month. */
export const defaultInvoiceNo = (month: string, city?: City, nth = 1) =>
  `INV-${month.replace("-", "")}${city ? `-${city.slice(0, 3).toUpperCase()}` : ""}${nth > 1 ? `-${nth}` : ""}`;

/** Totals, per-person groups and per-tag-type totals for a set of lines (used on the server and for the ticked tags on the page). */
export function summarize(lines: InvoiceLine[]): Pick<InvoiceBuild, "people" | "byType" | "tot"> {
  const out = { people: [] as PersonGroup[], byType: {} as InvoiceBuild["byType"], tot: emptyTotals() };
  for (const line of lines) {
    let g = out.people.find((p) => p.name === line.person);
    if (!g) out.people.push((g = { name: line.person, lines: [], tot: emptyTotals() }));
    g.lines.push(line);
    const b = (out.byType[line.type] ??= emptyTotals());
    for (const t of [g.tot, b, out.tot]) {
      t.jobs += 1;
      t.actual += line.actual ?? 0;
      t.billed += line.billed;
      t.cents += line.cents;
    }
  }
  out.people.sort((a, b) => (a.name === UNASSIGNED ? 1 : b.name === UNASSIGNED ? -1 : a.name.localeCompare(b.name)));
  return out;
}

/**
 * Completed jobs finished in `month` (local days in `tz`), or between `from` and `to` when a date range is given, with billing worked out.
 * `city` keeps one city's tags; `only` keeps just those job ids (the tags ticked for this invoice).
 */
export function buildInvoice(
  rows: InvoiceRow[],
  o: { month: string; tz: string; rateCents: number; minMin: number; roundTo: number; city?: City; only?: number[]; from?: string; to?: string },
): InvoiceBuild {
  const only = o.only ? new Set(o.only) : null;
  const inRange = o.from && o.to ? { from: o.from, to: o.to } : null;
  const inMonth = rows
    .filter((r) => {
      if (!r.removed_at) return false;
      // a date range (local days, both ends included) when one is given, otherwise the whole month
      if (inRange) {
        const d = localDate(r.removed_at, o.tz);
        return d >= inRange.from && d <= inRange.to;
      }
      return localMonth(r.removed_at, o.tz) === o.month;
    })
    .filter((r) => !o.city || cityOf(r) === o.city)
    .filter((r) => !only || only.has(r.id))
    .sort((a, b) => Date.parse(a.removed_at) - Date.parse(b.removed_at) || a.id - b.id);

  const lines: InvoiceLine[] = [];
  const warn: InvoiceBuild["warn"] = { notime: [], noaddr: [], noafter: [] };
  for (const r of inMonth) {
    const actual = r.duration_min === null ? null : r.duration_min;
    const { billed, cents, minApplied } = billTag(actual, o.minMin, o.roundTo, o.rateCents);
    const type: GraffitiType = isType(r.gtype) ? r.gtype : "other";
    const person = (r.done_by ?? "").trim() || UNASSIGNED;
    lines.push({ ...r, type, actual, billed, cents, minApplied, day: localDate(r.removed_at, o.tz), person, cityName: cityOf(r), cityAuto: autoCity(r.lat, r.lng) });
    if (actual === null) warn.notime.push(r.id);
    if (!r.address || r.address.trim() === "") warn.noaddr.push(r.id);
    if (!r.after_photo) warn.noafter.push(r.id);
  }
  return { lines, ids: lines.map((l) => l.id), warn, ...summarize(lines) };
}

export type InvoiceSnapshot = {
  /** One row per invoice sent; a month can have several (tags left unticked go on a later one). */
  id: number;
  city: City;
  month: string;
  invoice_no: string;
  invoice_date: string;
  invoiced_at: string;
  jobs: number;
  actual_min: number;
  billed_min: number;
  total_cents: number;
  rate_cents: number;
  min_minutes: number;
  round_to: number;
  job_ids: number[];
  /** Set when the invoice covers a date range instead of the whole month (`month` is then the month of date_from). */
  date_from?: string | null;
  date_to?: string | null;
};

/** Tags finished in an invoiced month after it was marked (added) or that no longer qualify (dropped). */
export function diffSnapshot(snapshotIds: number[], currentIds: number[]) {
  const snap = new Set(snapshotIds);
  const cur = new Set(currentIds);
  return {
    added: currentIds.filter((id) => !snap.has(id)),
    dropped: snapshotIds.filter((id) => !cur.has(id)),
  };
}

export type MonthRow = {
  month: string;
  count: number; // finished tags in this city that month
  unbilled: number; // of those, tags on no sent invoice yet
  invoices: InvoiceSnapshot[];
};

/** Every month with finished work for one city (plus any it has invoices for), newest first. */
export function monthTable(
  rows: { id: number; removed_at: string; city?: string | null; lat: number; lng: number }[],
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
    if (cityOf(r) !== city) continue;
    const m = row(localMonth(r.removed_at, tz));
    m.count += 1;
    if (!billed.has(r.id)) m.unbilled += 1;
  }
  for (const i of invoices) if (i.city === city) row(i.month).invoices.push(i);
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** Past months with finished work still not on any sent invoice. */
export function unbilledMonths(table: MonthRow[], currentMonth: string): string[] {
  return table.filter((r) => r.month < currentMonth && r.unbilled > 0).map((r) => r.month);
}

// ---------- CSV (for your own records) ----------

/** A leading = + - @ would run as a formula in a spreadsheet; prefix it. */
export function csvSafe(v: string | null | undefined): string {
  const s = v ?? "";
  return s !== "" && "=+-@\t\r".includes(s[0]) ? `'${s}` : s;
}
function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(
  b: InvoiceBuild,
  o: { invNo: string; tz: string; rateCents: number },
): string {
  const head = [
    "Invoice", "Job #", "Date finished", "Done by", "Location / intersection", "Tag type", "Surface", "Chemical used", "Started", "Finished",
    "Actual minutes", "Billed minutes", "Minimum applied", "Rate per hour", "Amount", "Notes", "Description", "Latitude", "Longitude",
  ];
  const rows: (string | number | null)[][] = [head];
  for (const r of b.lines) {
    rows.push([
      o.invNo, r.id, r.day, csvSafe(r.person), csvSafe(r.address), csvSafe(typeName(r.type, r.gtype_other)),
      csvSafe(r.surface), csvSafe(chemicalOf(r)),
      r.started_at ? localStamp(r.started_at, o.tz) : "", // seconds kept for your records
      localStamp(r.finished_at ?? r.removed_at, o.tz),
      r.actual, r.billed, r.minApplied ? "yes" : "no",
      (o.rateCents / 100).toFixed(2), (r.cents / 100).toFixed(2),
      csvSafe(r.notes), csvSafe(r.description), r.lat, r.lng,
    ]);
  }
  rows.push([]);
  rows.push(["TOTAL", "", "", "", "", "", "", "", "", "", b.tot.actual, b.tot.billed, "", "", (b.tot.cents / 100).toFixed(2)]);
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
