// Minimal, dependency-free iCalendar (.ics) reader for the room dashboard.
//
// Built for the feeds iCloud publishes ("Public Calendar" links), but it's
// plain RFC 5545: unfolds lines, reads VEVENTs, converts TZID wall-clock times
// to real instants with the platform's Intl time-zone data, and expands the
// recurrence rules people actually use (daily / weekly / monthly / yearly
// with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS), plus
// EXDATE and moved/cancelled single occurrences (RECURRENCE-ID).
//
// Anything exotic it doesn't understand degrades to "show the first
// occurrence" rather than throwing — a dashboard should never go blank over
// one weird event.
//
// A few low-level pieces (unfold/parseLine/unescapeText/parseDateValue, and
// the Prop type) are exported so lib/caldav.ts can reuse the same RFC 5545
// line parser for VTODO (Reminders) items instead of duplicating it.

export type CalendarEvent = {
  id: string;
  title: string;
  location: string | null;
  calendar: string | null;
  start: string; // ISO instant
  end: string; // ISO instant
  allDay: boolean;
};

export type Prop = { name: string; params: Record<string, string>; value: string };

type Wall = { y: number; m: number; d: number; h: number; mi: number; s: number };

type DateValue = {
  wall: Wall;
  tz: string | null; // null = UTC (value ended in Z)
  allDay: boolean;
};

type RawEvent = {
  uid: string;
  summary: string;
  location: string | null;
  status: string | null;
  start: DateValue;
  end: DateValue | null;
  durationMs: number | null;
  rrule: Record<string, string> | null;
  exdates: DateValue[];
  recurrenceId: DateValue | null;
};

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_PERIODS = 20000;

// ---------- Time-zone math (no libraries: Intl knows every IANA zone) ----------

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zoneParts(ms: number, tz: string): Wall {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, fmt);
  }
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

function wallAsUtc(w: Wall): number {
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
}

// Wall-clock time in a zone -> real instant (ms). Two passes settle DST edges.
export function zonedToMs(w: Wall, tz: string): number {
  const target = wallAsUtc(w);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const offset = wallAsUtc(zoneParts(guess, tz)) - guess;
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

function toMs(v: DateValue, fallbackTz: string): number {
  if (v.tz === null) return wallAsUtc(v.wall);
  return zonedToMs(v.wall, v.tz || fallbackTz);
}

// ---------- Parsing ----------

export function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

export function parseLine(line: string): Prop | null {
  // NAME;PARAM=a;PARAM2="b:c":VALUE — the first colon outside quotes splits.
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segs = head.split(";");
  const params: Record<string, string> = {};
  for (const seg of segs.slice(1)) {
    const eq = seg.indexOf("=");
    if (eq > 0) params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: segs[0].toUpperCase(), params, value };
}

export function unescapeText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
}

export function parseDateValue(raw: string, params: Record<string, string>, defaultTz: string): DateValue | null {
  const v = raw.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || params.VALUE === "DATE") {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return {
      wall: { y: +m[1], m: +m[2], d: +m[3], h: 0, mi: 0, s: 0 },
      tz: defaultTz,
      allDay: true,
    };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const wall = { y: +m[1], m: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0 };
  if (m[7]) return { wall, tz: null, allDay: false };
  const tzid = params.TZID;
  return { wall, tz: tzid && validZone(tzid) ? tzid : defaultTz, allDay: false };
}

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const [w, d, h, mi, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => (x ? +x : 0));
  return sign * ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

function parseRRule(v: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of v.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
  }
  return out;
}

export function parseCalendar(text: string, defaultTz: string): { name: string | null; events: RawEvent[] } {
  const lines = unfold(text);
  const events: RawEvent[] = [];
  let name: string | null = null;
  let props: Prop[] | null = null;
  let depth = 0; // nested components inside a VEVENT (e.g. VALARM) are skipped

  for (const line of lines) {
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;

    if (p.name === "BEGIN") {
      if (props) depth++;
      else if (p.value.toUpperCase() === "VEVENT") props = [];
      continue;
    }
    if (p.name === "END") {
      if (props && depth > 0) {
        depth--;
        continue;
      }
      if (props && p.value.toUpperCase() === "VEVENT") {
        const ev = buildEvent(props, defaultTz);
        if (ev) events.push(ev);
        props = null;
      }
      continue;
    }
    if (props) {
      if (depth === 0) props.push(p);
    } else if (p.name === "X-WR-CALNAME") {
      name = unescapeText(p.value);
    }
  }
  return { name, events };
}

function buildEvent(props: Prop[], defaultTz: string): RawEvent | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const dtstart = get("DTSTART");
  if (!dtstart) return null;
  const start = parseDateValue(dtstart.value, dtstart.params, defaultTz);
  if (!start) return null;

  const dtend = get("DTEND");
  const duration = get("DURATION");
  const rrule = get("RRULE");
  const recur = get("RECURRENCE-ID");

  const exdates: DateValue[] = [];
  for (const p of props.filter((x) => x.name === "EXDATE")) {
    for (const piece of p.value.split(",")) {
      const d = parseDateValue(piece, p.params, defaultTz);
      if (d) exdates.push(d);
    }
  }

  return {
    uid: get("UID")?.value.trim() || `${dtstart.value}-${get("SUMMARY")?.value ?? ""}`,
    summary: unescapeText(get("SUMMARY")?.value ?? "(No title)") || "(No title)",
    location: get("LOCATION") ? unescapeText(get("LOCATION")!.value) || null : null,
    status: get("STATUS")?.value.trim().toUpperCase() ?? null,
    start,
    end: dtend ? parseDateValue(dtend.value, dtend.params, defaultTz) : null,
    durationMs: duration ? parseDuration(duration.value) : null,
    rrule: rrule ? parseRRule(rrule.value) : null,
    exdates,
    recurrenceId: recur ? parseDateValue(recur.value, recur.params, defaultTz) : null,
  };
}

// ---------- Recurrence expansion (in wall-clock days, so DST stays right) ----------

type Day = { y: number; m: number; d: number };

function dayNum(day: Day): number {
  return Math.floor(Date.UTC(day.y, day.m - 1, day.d) / 86400000);
}

function fromDayNum(n: number): Day {
  const dt = new Date(n * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function weekday(day: Day): number {
  return new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
}

type ByDay = { ord: number; wd: number };

function parseByDay(v: string | undefined): ByDay[] {
  if (!v) return [];
  const out: ByDay[] = [];
  for (const tok of v.split(",")) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(tok.trim());
    if (m) out.push({ ord: m[1] ? parseInt(m[1], 10) : 0, wd: DAY_CODES.indexOf(m[2]) });
  }
  return out;
}

function nums(v: string | undefined): number[] {
  return v ? v.split(",").map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x) && x !== 0) : [];
}

// All candidate days within one month for MONTHLY/YEARLY rules.
function monthDays(y: number, m: number, byday: ByDay[], bymonthday: number[], fallbackDay: number): number[] {
  const dim = daysInMonth(y, m);
  let days: number[] = [];

  if (bymonthday.length) {
    for (const md of bymonthday) {
      const d = md > 0 ? md : dim + md + 1;
      if (d >= 1 && d <= dim) days.push(d);
    }
  }

  if (byday.length) {
    const fromByDay: number[] = [];
    for (const { ord, wd } of byday) {
      const matches: number[] = [];
      for (let d = 1; d <= dim; d++) if (weekday({ y, m, d }) === wd) matches.push(d);
      if (ord === 0) fromByDay.push(...matches);
      else {
        const pick = ord > 0 ? matches[ord - 1] : matches[matches.length + ord];
        if (pick) fromByDay.push(pick);
      }
    }
    days = bymonthday.length ? days.filter((d) => fromByDay.includes(d)) : fromByDay;
  }

  if (!bymonthday.length && !byday.length && fallbackDay <= dim) days.push(fallbackDay);
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

function applySetPos<T>(list: T[], setpos: number[]): T[] {
  if (!setpos.length) return list;
  const out: T[] = [];
  for (const p of setpos) {
    const item = p > 0 ? list[p - 1] : list[list.length + p];
    if (item !== undefined) out.push(item);
  }
  return out;
}

// Yields occurrence start days (wall-clock, in the event's zone) in order.
function* occurrenceDays(start: Day, rule: Record<string, string>): Generator<Day> {
  const freq = rule.FREQ;
  const interval = Math.max(1, parseInt(rule.INTERVAL || "1", 10) || 1);
  const byday = parseByDay(rule.BYDAY);
  const bymonthday = nums(rule.BYMONTHDAY);
  const bymonth = nums(rule.BYMONTH);
  const setpos = nums(rule.BYSETPOS);
  const startN = dayNum(start);

  if (freq === "DAILY") {
    for (let k = 0; k < MAX_PERIODS; k++) {
      const day = fromDayNum(startN + k * interval);
      if (byday.length && !byday.some((b) => b.wd === weekday(day))) continue;
      if (bymonth.length && !bymonth.includes(day.m)) continue;
      yield day;
    }
    return;
  }

  if (freq === "WEEKLY") {
    const wkst = DAY_CODES.indexOf(rule.WKST || "MO");
    const back = (weekday(start) - (wkst < 0 ? 1 : wkst) + 7) % 7;
    const week0 = startN - back;
    const wds = byday.length ? byday.map((b) => b.wd) : [weekday(start)];
    for (let k = 0; k < MAX_PERIODS; k++) {
      const ws = week0 + k * 7 * interval;
      const inWeek = wds
        .map((wd) => ws + ((wd - (wkst < 0 ? 1 : wkst) + 7) % 7))
        .filter((n) => n >= startN)
        .sort((a, b) => a - b)
        .map(fromDayNum);
      for (const day of applySetPos(inWeek, setpos)) yield day;
    }
    return;
  }

  if (freq === "MONTHLY") {
    for (let k = 0; k < MAX_PERIODS; k++) {
      const idx = start.m - 1 + k * interval;
      const y = start.y + Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      if (bymonth.length && !bymonth.includes(m)) continue;
      const days = applySetPos(monthDays(y, m, byday, bymonthday, start.d), setpos);
      for (const d of days) {
        const day = { y, m, d };
        if (dayNum(day) >= startN) yield day;
      }
    }
    return;
  }

  if (freq === "YEARLY") {
    const months = bymonth.length ? bymonth : [start.m];
    for (let k = 0; k < MAX_PERIODS / 12; k++) {
      const y = start.y + k * interval;
      const all: Day[] = [];
      for (const m of months.slice().sort((a, b) => a - b)) {
        for (const d of monthDays(y, m, byday, bymonthday, start.d)) all.push({ y, m, d });
      }
      for (const day of applySetPos(all, setpos)) if (dayNum(day) >= startN) yield day;
    }
    return;
  }

  // Unknown frequency (hourly, secondly…): just the first occurrence.
  yield start;
}

// ---------- Public: events overlapping a window ----------

function key(ms: number): string {
  return String(ms);
}

export function eventsBetween(
  text: string,
  windowStart: Date,
  windowEnd: Date,
  defaultTz: string,
  calendarLabel?: string | null
): CalendarEvent[] {
  const { name, events } = parseCalendar(text, defaultTz);
  const label = calendarLabel ?? name;
  const wsMs = windowStart.getTime();
  const weMs = windowEnd.getTime();

  // Moved or cancelled single occurrences of a recurring series.
  const overrides = new Map<string, RawEvent>();
  for (const ev of events) {
    if (ev.recurrenceId) overrides.set(`${ev.uid}|${key(toMs(ev.recurrenceId, defaultTz))}`, ev);
  }

  const out: CalendarEvent[] = [];

  const lengthOf = (ev: RawEvent, startMs: number): number => {
    if (ev.end) return Math.max(0, toMs(ev.end, defaultTz) - toMs(ev.start, defaultTz));
    if (ev.durationMs !== null) return ev.durationMs;
    return ev.start.allDay ? 86400000 : 0;
  };

  const push = (ev: RawEvent, startMs: number, endMs: number, occKey: string) => {
    if (ev.status === "CANCELLED") return;
    if (endMs <= wsMs && !(endMs === startMs && startMs >= wsMs)) return;
    if (startMs >= weMs) return;
    out.push({
      id: `${ev.uid}|${occKey}`,
      title: ev.summary,
      location: ev.location,
      calendar: label,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      allDay: ev.start.allDay,
    });
  };

  for (const ev of events) {
    if (ev.recurrenceId) {
      // Overrides are emitted on their own (their own DTSTART is the new time).
      const s = toMs(ev.start, defaultTz);
      const len = ev.end ? Math.max(0, toMs(ev.end, defaultTz) - s) : ev.durationMs ?? (ev.start.allDay ? 86400000 : 0);
      push(ev, s, s + len, `r${key(toMs(ev.recurrenceId, defaultTz))}`);
      continue;
    }

    const firstMs = toMs(ev.start, defaultTz);
    const len = lengthOf(ev, firstMs);

    if (!ev.rrule) {
      push(ev, firstMs, firstMs + len, key(firstMs));
      continue;
    }

    const exSet = new Set(ev.exdates.map((x) => key(toMs(x, defaultTz))));
    const count = ev.rrule.COUNT ? parseInt(ev.rrule.COUNT, 10) : null;
    const untilDv = ev.rrule.UNTIL ? parseDateValue(ev.rrule.UNTIL, {}, defaultTz) : null;
    // A date-only UNTIL includes that whole day.
    const untilMs = untilDv ? toMs(untilDv, defaultTz) + (untilDv.allDay ? 86400000 - 1 : 0) : null;
    const zone = ev.start.tz ?? "UTC";
    const w = ev.start.wall;

    let n = 0;
    let guard = 0;
    for (const day of occurrenceDays({ y: w.y, m: w.m, d: w.d }, ev.rrule)) {
      if (++guard > MAX_PERIODS * 4) break;
      const wall = { ...day, h: w.h, mi: w.mi, s: w.s };
      const occMs = ev.start.tz === null ? wallAsUtc(wall) : zonedToMs(wall, zone);
      if (untilMs !== null && occMs > untilMs) break;
      n++;
      if (count !== null && n > count) break;
      if (occMs >= weMs) break;
      const k = key(occMs);
      if (exSet.has(k)) continue;
      if (overrides.has(`${ev.uid}|${k}`)) continue;
      push(ev, occMs, occMs + len, k);
    }
  }

  return out;
}
