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

export const GRAFFITI_TYPES = ["ssr", "slap", "powerwash", "other"] as const;
export type GraffitiType = (typeof GRAFFITI_TYPES)[number];

export const TYPE_NAMES: Record<GraffitiType, string> = {
  ssr: "SSR",
  slap: "Slap tag",
  powerwash: "Powerwash",
  other: "Other",
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
export const CHEMICAL_OPTIONS = ["SSR", "Graffiti remover", "Pressure wash", "Paint over", "Other"];

export const MAX_MINUTES = 1440;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const PHOTO_NAME_RE = /^[a-f0-9]{32}\.jpg$/;

export function isStatus(v: unknown): v is GraffitiStatus {
  return typeof v === "string" && (GRAFFITI_STATUSES as readonly string[]).includes(v);
}
export function isType(v: unknown): v is GraffitiType {
  return typeof v === "string" && (GRAFFITI_TYPES as readonly string[]).includes(v);
}
export function typeName(v: string | null | undefined): string {
  return isType(v) ? TYPE_NAMES[v] : TYPE_NAMES.other;
}

// ---------- Types ----------

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
  /** Whoever finished (or took) the job: the account that gets the credit on the invoice. */
  removed_by_name: string | null;
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

  const gtype: GraffitiType = isType(fields.gtype) ? fields.gtype : "other";
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
      description: clean(fields.description, 2000),
      reported_at: started ?? iso(nowMs),
      started_at: started,
      finished_at: finished,
      removed_at: removed,
      duration_min: duration,
      urgent: flag(fields.urgent),
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
 *  - restarting a finished job drops its old time
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
      patch.finished_at = null;
      patch.removed_at = null;
      // a restarted job loses its old time; a fresh start ignores any typed time
      durationGiven = row.status === "removed";
      durationVal = null;
    } else if (status === "removed") {
      // the clock stops when the after photo was taken (never before the job started)
      let finishMs = photoTime(fields.photo_at, nowMs);
      if (row.started_at !== null) {
        const startMs = Date.parse(row.started_at);
        if (!Number.isNaN(startMs)) finishMs = Math.max(finishMs, startMs);
      }
      if (row.removed_at === null) patch.removed_at = iso(finishMs);
      if (row.finished_at === null) patch.finished_at = iso(finishMs);
      // time from the photos unless the crew typed a number
      if (row.status !== "removed" && !(durationGiven && durationVal !== null)) {
        const auto = minutesBetween(row.started_at, finishMs);
        if (auto !== null) {
          durationGiven = true;
          durationVal = Math.min(auto, MAX_MINUTES);
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
  }
  if (has("address")) patch.address = clean(fields.address, 255);
  if (has("notes")) patch.notes = clean(fields.notes, 2000);
  if (has("scheduled_for")) {
    const d = (fields.scheduled_for ?? "").trim();
    if (d !== "" && !(/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)))) {
      return { ok: false, error: "Bad date" };
    }
    patch.scheduled_for = d === "" ? null : d;
  }

  if (has("urgent")) patch.urgent = flag(fields.urgent);
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
  bill_to: string;
  po_number: string;
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

export const defaultInvoiceNo = (month: string) => `INV-${month.replace("-", "")}`;

/** Completed jobs finished in `month` (local days in `tz`), with billing worked out. */
export function buildInvoice(
  rows: InvoiceRow[],
  o: { month: string; tz: string; rateCents: number; minMin: number; roundTo: number },
): InvoiceBuild {
  const out: InvoiceBuild = { lines: [], people: [], ids: [], byType: {}, tot: emptyTotals(), warn: { notime: [], noaddr: [], noafter: [] } };
  const inMonth = rows
    .filter((r) => r.removed_at && localMonth(r.removed_at, o.tz) === o.month)
    .sort((a, b) => Date.parse(a.removed_at) - Date.parse(b.removed_at) || a.id - b.id);

  for (const r of inMonth) {
    const actual = r.duration_min === null ? null : r.duration_min;
    const { billed, cents, minApplied } = billTag(actual, o.minMin, o.roundTo, o.rateCents);
    const type: GraffitiType = isType(r.gtype) ? r.gtype : "other";
    const person = (r.done_by ?? "").trim() || UNASSIGNED;
    const line: InvoiceLine = { ...r, type, actual, billed, cents, minApplied, day: localDate(r.removed_at, o.tz), person };
    out.lines.push(line);
    out.ids.push(r.id);
    let g = out.people.find((p) => p.name === person);
    if (!g) out.people.push((g = { name: person, lines: [], tot: emptyTotals() }));
    g.lines.push(line);
    g.tot.jobs += 1;
    g.tot.actual += actual ?? 0;
    g.tot.billed += billed;
    g.tot.cents += cents;

    const b = (out.byType[type] ??= emptyTotals());
    for (const t of [b, out.tot]) {
      t.jobs += 1;
      t.actual += actual ?? 0;
      t.billed += billed;
      t.cents += cents;
    }
    if (actual === null) out.warn.notime.push(r.id);
    if (!r.address || r.address.trim() === "") out.warn.noaddr.push(r.id);
    if (!r.after_photo) out.warn.noafter.push(r.id);
  }
  out.people.sort((a, b) => (a.name === UNASSIGNED ? 1 : b.name === UNASSIGNED ? -1 : a.name.localeCompare(b.name)));
  return out;
}

export type InvoiceSnapshot = {
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

export type MonthRow = { month: string; count: number; invoice: InvoiceSnapshot | null };

/** Every month with finished work (plus any marked invoiced), newest first. */
export function monthTable(removedAt: string[], invoices: InvoiceSnapshot[], tz: string): MonthRow[] {
  const counts = new Map<string, number>();
  for (const ts of removedAt) {
    const k = localMonth(ts, tz);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const inv = new Map(invoices.map((i) => [i.month, i]));
  for (const k of inv.keys()) if (!counts.has(k)) counts.set(k, 0);
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, count]) => ({ month, count, invoice: inv.get(month) ?? null }));
}

/** Past months with finished work that were never marked invoiced. */
export function unbilledMonths(table: MonthRow[], currentMonth: string): string[] {
  return table.filter((r) => r.month < currentMonth && r.count > 0 && !r.invoice).map((r) => r.month);
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
      o.invNo, r.id, r.day, csvSafe(r.person), csvSafe(r.address), TYPE_NAMES[r.type],
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
