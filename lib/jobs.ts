import {
  City,
  Fail,
  Fields,
  MAX_MINUTES,
  Ok,
  clean,
  isCity,
  minutesBetween,
  parseMinutes,
  photoTime,
} from "@/lib/graffiti";

// Pure logic for the work-order / lawn-care / other-jobs tabs. No database, no Next.js — the API routes
// and the tests share this file. Graffiti keeps its own tracker; this is the generic one.

/** The three job tabs. The same keys are used as permission keys (Admin tab) and as the `jtype` column. */
export const JOB_TYPES = ["workorders", "lawn", "otherjobs"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  workorders: "Work orders",
  lawn: "Lawn care",
  otherjobs: "Other jobs",
};

/** Singular, for buttons: "Log new work order". */
export const JOB_TYPE_ONE: Record<JobType, string> = {
  workorders: "work order",
  lawn: "lawn job",
  otherjobs: "job",
};

export function isJobType(v: unknown): v is JobType {
  return typeof v === "string" && (JOB_TYPES as readonly string[]).includes(v);
}

export const JOB_STATUSES = ["open", "in_progress", "done"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { open: "Open", in_progress: "In progress", done: "Done" };
export function isJobStatus(v: unknown): v is JobStatus {
  return typeof v === "string" && (JOB_STATUSES as readonly string[]).includes(v);
}

export const BILL_MODES = ["hourly", "flat", "hourly_materials"] as const;
export type BillMode = (typeof BILL_MODES)[number];
export const BILL_MODE_LABEL: Record<BillMode, string> = {
  hourly: "Hourly",
  flat: "Flat price",
  hourly_materials: "Hours + materials",
};
export function isBillMode(v: unknown): v is BillMode {
  return typeof v === "string" && (BILL_MODES as readonly string[]).includes(v);
}

export type Material = { desc: string; cents: number };
export const MAX_MATERIALS = 30;
export const MAX_MONEY_CENTS = 100_000_000; // $1,000,000 — a typo guard, not a business limit

export type Job = {
  id: number;
  jtype: JobType;
  status: JobStatus;
  title: string;
  wo_number: string | null;
  city: City;
  address: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  notes: string | null;
  bill_mode: BillMode;
  price_cents: number | null;
  materials: Material[];
  before_photo: string | null;
  after_photo: string | null;
  started_at: string | null;
  finished_at: string | null;
  done_at: string | null;
  duration_min: number | null;
  created_at: string;
  created_by_name: string | null;
  done_by_name: string | null;
  /** Set by the server: true when the signed-in person logged it. */
  mine?: boolean;
};

const iso = (ms: number) => new Date(ms).toISOString();

function parseCoord(v: string | undefined, limit: number): number | null {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return n;
}

/** "12.50" / "$1,200" -> 1250 / 120000 cents; blank -> null. */
export function parseMoney(v: string | null | undefined): Ok<{ cents: number | null }> | Fail {
  const s = (v ?? "").trim().replace(/[$,\s]/g, "");
  if (s === "") return { ok: true, cents: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: "Enter a dollar amount like 125 or 125.50" };
  const cents = Math.round(Number(s) * 100);
  if (cents > MAX_MONEY_CENTS) return { ok: false, error: "That amount is too large" };
  return { ok: true, cents };
}

/** The materials list arrives as a JSON string: [{"desc":"Mulch","amount":"45.50"}] (amount in dollars). */
export function parseMaterials(v: string | null | undefined): Ok<{ list: Material[] }> | Fail {
  const s = (v ?? "").trim();
  if (s === "") return { ok: true, list: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    return { ok: false, error: "Bad materials list" };
  }
  if (!Array.isArray(raw)) return { ok: false, error: "Bad materials list" };
  if (raw.length > MAX_MATERIALS) return { ok: false, error: `At most ${MAX_MATERIALS} materials per job` };
  const list: Material[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") return { ok: false, error: "Bad materials list" };
    const o = item as Record<string, unknown>;
    const desc = clean(typeof o.desc === "string" ? o.desc : "", 80);
    const amountRaw = o.amount !== undefined ? String(o.amount) : o.cents !== undefined ? String(Number(o.cents) / 100) : "";
    const m = parseMoney(amountRaw);
    if (!m.ok) return m;
    // an entirely blank row (the empty line at the bottom of the form) is dropped
    if (!desc && m.cents === null) continue;
    if (!desc) return { ok: false, error: "Every material needs a name" };
    if (m.cents === null) return { ok: false, error: `Give "${desc}" an amount` };
    list.push({ desc, cents: m.cents });
  }
  return { ok: true, list };
}

export const materialsTotal = (list: Material[]) => list.reduce((n, m) => n + m.cents, 0);

// ---------- Create ----------

export type NewJob = {
  status: JobStatus;
  title: string;
  wo_number: string | null;
  city: City;
  address: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  started_at: string | null;
  finished_at: string | null;
  done_at: string | null;
  duration_min: number | null;
  bill_mode: BillMode;
  price_cents: number | null;
  materials: Material[];
};

/**
 * mode "open":  logged, no work yet (default).
 * mode "start": before photo taken, clock starts at the photo time.
 * mode "done":  already finished (minutes typed in).
 * Billing fields (bill_mode / price / materials) are only honoured when `canBill`; everyone else gets hourly.
 */
export function computeJobCreate(fields: Fields, nowMs: number, canBill: boolean): Ok<{ row: NewJob }> | Fail {
  const title = clean(fields.title, 120);
  if (!title) return { ok: false, error: "Give the job a title" };
  if (!isCity(fields.city)) return { ok: false, error: "Pick Helena or Bozeman" };

  const lat = parseCoord(fields.lat, 90);
  const lng = parseCoord(fields.lng, 180);
  const hasPin = lat !== null && lng !== null;

  const mode = fields.mode === "start" || fields.mode === "done" ? fields.mode : "open";
  let status: JobStatus = "open";
  let started: string | null = null;
  let finished: string | null = null;
  let done: string | null = null;
  let duration: number | null = null;
  if (mode === "start") {
    status = "in_progress";
    started = iso(photoTime(fields.photo_at, nowMs));
  } else if (mode === "done") {
    status = "done";
    finished = done = iso(nowMs);
    const m = parseMinutes(fields.duration_min);
    if (!m.ok) return m;
    duration = m.value;
  }

  let bill_mode: BillMode = "hourly";
  let price_cents: number | null = null;
  let materials: Material[] = [];
  if (canBill) {
    if (fields.bill_mode !== undefined && fields.bill_mode !== "") {
      if (!isBillMode(fields.bill_mode)) return { ok: false, error: "Bad billing type" };
      bill_mode = fields.bill_mode;
    }
    const p = parseMoney(fields.price);
    if (!p.ok) return p;
    price_cents = bill_mode === "flat" ? p.cents : null;
    const mats = parseMaterials(fields.materials);
    if (!mats.ok) return mats;
    materials = bill_mode === "hourly_materials" ? mats.list : [];
  }

  return {
    ok: true,
    row: {
      status,
      title,
      wo_number: clean(fields.wo_number, 60),
      city: fields.city,
      address: clean(fields.address, 255),
      lat: hasPin ? Math.round(lat * 1e6) / 1e6 : null,
      lng: hasPin ? Math.round(lng * 1e6) / 1e6 : null,
      description: clean(fields.description, 2000),
      started_at: started,
      finished_at: finished,
      done_at: done,
      duration_min: duration,
      bill_mode,
      price_cents,
      materials,
    },
  };
}

// ---------- Update ----------

export type CurrentJob = {
  status: JobStatus;
  started_at: string | null;
  finished_at: string | null;
  done_at: string | null;
  bill_mode: BillMode;
};

export type JobPatch = Partial<{
  status: JobStatus;
  title: string;
  wo_number: string | null;
  city: City;
  address: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  notes: string | null;
  started_at: string | null;
  finished_at: string | null;
  done_at: string | null;
  duration_min: number | null;
  bill_mode: BillMode;
  price_cents: number | null;
  materials: Material[];
}>;

const BILLING_KEYS = ["bill_mode", "price", "materials"] as const;

/** True when the form tries to change anything money-related. */
export const touchesBilling = (fields: Fields) => BILLING_KEYS.some((k) => Object.prototype.hasOwnProperty.call(fields, k));

/**
 * Works out what an update changes. `act` is the one-tap action from the photo buttons:
 * "start" (before photo) or "finish" (after photo).
 *  - starting stamps started_at with the before-photo time (first start only)
 *  - finishing stamps the finish with the after-photo time and, unless minutes were typed,
 *    sets the time on site from the two photo times (a job that never started has no automatic time)
 *  - moving back to open clears the work-in-progress data; restarting a finished job drops its old time
 */
export function computeJobUpdate(
  row: CurrentJob,
  fields: Fields,
  nowMs: number,
  hasNewPhoto: boolean,
  canBill: boolean,
): Ok<{ patch: JobPatch }> | Fail {
  const patch: JobPatch = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(fields, k);

  if (touchesBilling(fields) && !canBill) return { ok: false, error: "Only the owner (or someone with the invoice switch) can change billing." };

  let status: string | null = has("status") ? fields.status : null;
  if (fields.act === "start") status = "in_progress";
  else if (fields.act === "finish") status = "done";

  let durationGiven = has("duration_min");
  let durationVal: number | null = null;
  if (durationGiven) {
    const m = parseMinutes(fields.duration_min);
    if (!m.ok) return m;
    durationVal = m.value;
  }

  if (status !== null) {
    if (!isJobStatus(status)) return { ok: false, error: "Bad status" };
    patch.status = status;
    if (status === "in_progress") {
      if (row.started_at === null) patch.started_at = iso(photoTime(fields.photo_at, nowMs));
      patch.finished_at = null;
      patch.done_at = null;
      durationGiven = row.status === "done";
      durationVal = null;
    } else if (status === "done") {
      let finishMs = photoTime(fields.photo_at, nowMs);
      if (row.started_at !== null) {
        const startMs = Date.parse(row.started_at);
        if (!Number.isNaN(startMs)) finishMs = Math.max(finishMs, startMs);
      }
      if (row.done_at === null) patch.done_at = iso(finishMs);
      if (row.finished_at === null) patch.finished_at = iso(finishMs);
      if (row.status !== "done" && !(durationGiven && durationVal !== null)) {
        const auto = minutesBetween(row.started_at, finishMs);
        if (auto !== null) {
          durationGiven = true;
          durationVal = Math.min(auto, MAX_MINUTES);
        }
      }
    } else {
      patch.started_at = null;
      patch.finished_at = null;
      patch.done_at = null;
      patch.duration_min = null;
      durationGiven = false;
    }
  }
  if (durationGiven) patch.duration_min = durationVal;

  if (has("title")) {
    const t = clean(fields.title, 120);
    if (!t) return { ok: false, error: "Give the job a title" };
    patch.title = t;
  }
  if (has("wo_number")) patch.wo_number = clean(fields.wo_number, 60);
  if (has("city")) {
    if (!isCity(fields.city)) return { ok: false, error: "Pick Helena or Bozeman" };
    patch.city = fields.city;
  }
  if (has("address")) patch.address = clean(fields.address, 255);
  if (has("lat") || has("lng")) {
    const lat = parseCoord(fields.lat, 90);
    const lng = parseCoord(fields.lng, 180);
    // a pin is both numbers or nothing
    if (lat !== null && lng !== null) {
      patch.lat = Math.round(lat * 1e6) / 1e6;
      patch.lng = Math.round(lng * 1e6) / 1e6;
    } else {
      patch.lat = null;
      patch.lng = null;
    }
  }
  if (has("description")) patch.description = clean(fields.description, 2000);
  if (has("notes")) patch.notes = clean(fields.notes, 2000);

  if (canBill) {
    if (has("bill_mode")) {
      if (!isBillMode(fields.bill_mode)) return { ok: false, error: "Bad billing type" };
      patch.bill_mode = fields.bill_mode;
    }
    const mode = patch.bill_mode ?? row.bill_mode;
    if (has("price")) {
      const p = parseMoney(fields.price);
      if (!p.ok) return p;
      patch.price_cents = p.cents;
    }
    if (has("materials")) {
      const mats = parseMaterials(fields.materials);
      if (!mats.ok) return mats;
      patch.materials = mats.list;
    }
    // switching billing type drops the numbers that no longer apply
    if (patch.bill_mode !== undefined) {
      if (mode !== "flat" && !has("price")) patch.price_cents = null;
      if (mode !== "hourly_materials" && !has("materials")) patch.materials = [];
    }
    if (mode !== "flat" && patch.price_cents !== undefined) patch.price_cents = null;
    if (mode !== "hourly_materials" && patch.materials !== undefined) patch.materials = [];
  }

  if (Object.keys(patch).length === 0 && !hasNewPhoto) return { ok: false, error: "Nothing to update" };
  return { ok: true, patch };
}
