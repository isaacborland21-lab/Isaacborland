// Trends & analysis for the graffiti tags: how many we are finding, where, what kind, and what keeps coming back.
// Pure functions only (no database, no React) so the API route, the page and the tests all agree.
//
// One honest limit shapes everything here: the tracker only knows when a crew FOUND and logged a tag, not when the
// graffiti went up. More patrolling means more tags found, so counts over time say as much about effort as about
// vandalism. The insights below are worded (and guarded by minimum sample sizes) with that in mind.

import { City, CITIES, TYPE_NAMES, cityOf, isCity, isType, localDate } from "@/lib/graffiti";
import { cellBounds, cellCenter, cellKey, meters } from "@/lib/patrol";

export type TrendRow = {
  id: number;
  /** Null for a tag imported from an old invoice that could not be placed on the map. */
  lat: number | null;
  lng: number | null;
  city: string | null;
  address: string | null;
  gtype: string;
  gtype_other: string | null;
  surface: string | null;
  chemical: string | null;
  reported_at: string;
  removed_at: string | null;
  duration_min: number | null;
  status: string;
  urgent: boolean | null;
  /** Who handled it: finished by, else took it, else reported it. */
  who: string | null;
  /** "history" = imported from an old invoice. Counted everywhere, but it may have no map position and it never counts toward "repeat spots". */
  src?: "history";
};

export type TrendOptions = {
  /** First local day to include, "YYYY-MM-DD". Null = from the first tag. */
  from: string | null;
  /** Last local day to include. Null = today. */
  to: string | null;
  city: City | "all";
  /** A tag type key, or "all". */
  type: string;
  tz: string;
  nowMs: number;
};

export type Bucket = { key: string; label: string; n: number; pct: number; avgMin: number | null; minutes: number };
export type StreetBucket = { key: string; label: string; city: City; n: number; pct: number; last: string; topType: string };
export type HotBlock = { key: string; lat: number; lng: number; bounds: [[number, number], [number, number]]; n: number; label: string; topType: string; last: string };
export type RepeatSite = { label: string; lat: number; lng: number; tags: number; days: number; firstDay: string; lastDay: string; typeLabel: string };
export type Insight = { level: "warn" | "note" | "info"; text: string };
export type MapPoint = { id: number; lat: number; lng: number; c: City; t: string; d: string; a: string | null };

export type Trends = {
  range: { from: string; to: string; days: number; firstTagDay: string | null; historyDays: number };
  totals: {
    tags: number;
    removed: number;
    open: number;
    urgent: number;
    perDay: number;
    minutes: number;
    avgMin: number | null;
    medianMin: number | null;
    /** How many of the counted tags came from imported old invoices. */
    imported: number;
    /** How many counted tags have no map position (so they are not on the map or in the blocks). */
    unplaced: number;
  };
  compare: { available: boolean; prevTags: number; deltaPct: number | null };
  series: { unit: "day" | "week" | "month"; points: { key: string; label: string; n: number }[] };
  byCity: Bucket[];
  byType: Bucket[];
  bySurface: Bucket[];
  byChemical: Bucket[];
  streets: StreetBucket[];
  blocks: HotBlock[];
  repeat: { tags: number; pct: number | null; sites: RepeatSite[]; medianGapDays: number | null };
  lag: { later: number; medianDays: number | null; open: number; oldestOpenDays: number | null; openList: { id: number; label: string; days: number }[] };
  crew: { name: string; n: number; minutes: number; avgMin: number | null }[];
  points: MapPoint[];
  insights: Insight[];
};

const DAY = 86_400_000;
const REPEAT_RADIUS_M = 25; // two tags this close are the same spot
const REPEAT_AFTER_MS = DAY; // ...and it counts as "came back" only if it is found a day or more after the last one was removed

// ---------- Small helpers ----------

const round1 = (n: number) => Math.round(n * 10) / 10;
const pctOf = (n: number, total: number) => (total > 0 ? round1((n / total) * 100) : 0);

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const ymdMs = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const msYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => msYmd(ymdMs(ymd) + n * DAY);
const diffDays = (a: string, b: string) => Math.round((ymdMs(b) - ymdMs(a)) / DAY);
const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && msYmd(ymdMs(v)) === v;
/** Monday of the week containing the day. */
const weekStart = (ymd: string) => addDays(ymd, -((new Date(ymdMs(ymd)).getUTCDay() + 6) % 7));
const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const fmtDay = (ymd: string) => new Date(ymdMs(ymd)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const fmtMonth = (ymd: string) => new Date(ymdMs(ymd)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The most common value; ties go to the one seen first. */
function mode<T>(xs: T[]): T | null {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let best: T | null = null;
  let bn = 0;
  for (const [k, v] of c)
    if (v > bn) {
      best = k;
      bn = v;
    }
  return best;
}

// ---------- Cleaning up what crews typed ----------

/** The tag-type key, with anything unknown treated as "other". */
export const typeKey = (g: string) => (isType(g) ? g : "other");
export const typeLabel = (g: string) => TYPE_NAMES[typeKey(g) as keyof typeof TYPE_NAMES];

/**
 * Crews type the surface by hand ("Bus Shelter", "Bus stop", "bus shelter"), so the same thing arrives under many
 * spellings. This folds the common ones together; anything unrecognised is kept as typed (tidied up).
 */
export function normalizeSurface(raw: string | null | undefined): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "Not recorded";
  const s = t.toLowerCase();
  if (/dog.?(waste|poop)|pet waste/.test(s)) return "Dog waste station";
  if (/stop ?light|traffic (light|signal)|signal pole|stop light/.test(s)) return "Stoplight pole";
  if (/crosswalk|cross walk|ped(estrian)? (button|signal)/.test(s)) return "Crosswalk pole / button";
  if (/bus (stop|shelter)|transit (stop|shelter)/.test(s)) return "Bus stop / shelter";
  if (/porta ?-?(potty|john)|portable (toilet|restroom)/.test(s)) return "Porta potty";
  if (/mail ?box/.test(s)) return "Mailbox";
  if (/(electrical|utility|power|transformer|junction) ?(box|cabinet)|\bcabinet\b/.test(s)) return "Electrical / utility box";
  if (/street ?lamp|light pole|lamp ?post|street ?light/.test(s)) return "Light pole / street lamp";
  if (/utility pole|power pole|telephone pole|wood(en)? pole/.test(s)) return "Utility pole";
  if (/trash|dumpster|garbage|waste (can|bin)|refuse/.test(s)) return "Trash can / dumpster";
  if (/\bsign|signpost|sign post/.test(s)) return "Sign / signpost";
  if (/fire ?hydrant|hydrant/.test(s)) return "Fire hydrant";
  if (/bike rack|bicycle rack/.test(s)) return "Bike rack";
  if (/building|brick|wall/.test(s)) return /brick/.test(s) ? "Brick wall" : /building/.test(s) ? "Building wall" : "Wall";
  if (/concrete|ground|sidewalk|pavement|asphalt|curb/.test(s)) return /concrete/.test(s) && !/ground|sidewalk|pavement|asphalt|curb/.test(s) ? "Concrete" : "Ground / concrete";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The chemical, with the typed-in "Other" answers folded together. */
export function normalizeChemical(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "Not recorded";
  const s = t.toLowerCase();
  if (s === "ssr") return "SSR";
  if (s === "bare brick" || s === "barebrick") return "Bare brick";
  if (s === "razor") return "Razor";
  return "Other";
}

const DIRS: Record<string, string> = { n: "North", s: "South", e: "East", w: "West" };
const SUFFIXES: Record<string, string> = {
  st: "Street",
  ave: "Avenue",
  av: "Avenue",
  dr: "Drive",
  ln: "Lane",
  blvd: "Boulevard",
  rd: "Road",
  ct: "Court",
  pl: "Place",
  hwy: "Highway",
  cir: "Circle",
  pkwy: "Parkway",
  trl: "Trail",
};

export type Addr = { num: number | null; full: string; base: string; /** the street's own name, lower case, without direction or suffix */ stem: string; hasSuffix: boolean };

const SUFFIX_FULL = new Set(Object.values(SUFFIXES));
const DIR_FULL = ["North", "South", "East", "West"];
/** Capitalizes a street word; ALL-CAPS or all-lower-case words (common on typed invoices) become Title Case. */
const cap = (w: string) => (w === w.toUpperCase() && w.length > 2 ? w.charAt(0) + w.slice(1).toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1));

/**
 * Splits an address into house number, street, and the street without its direction ("East Main Street" and
 * "West Main Street" are both "Main Street"). Intersections ("E Main St & S Rouse Ave") use the first street.
 */
export function parseAddress(raw: string | null | undefined): Addr | null {
  let t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  t = t.split(/\s+&\s+|\s+and\s+|\s+@\s+/i)[0].replace(/,.*$/, "").trim();
  let num: number | null = null;
  const m = /^(\d+)[A-Za-z]?\s+(.*)$/.exec(t);
  if (m) {
    num = Number(m[1]);
    t = m[2];
  }
  const words = t.replace(/\./g, "").split(" ").filter(Boolean).map(cap);
  if (words.length === 0) return null;
  if (words.length > 1 && DIRS[words[0].toLowerCase()]) words[0] = DIRS[words[0].toLowerCase()];
  const last = words.length - 1;
  if (last > 0 && SUFFIXES[words[last].toLowerCase()]) words[last] = SUFFIXES[words[last].toLowerCase()];
  const full = words.join(" ");
  const hasSuffix = words.length > 1 && SUFFIX_FULL.has(words[words.length - 1]);
  // "East Main Street" and "West Main Street" are one street; so are "East Main" and "North Rouse" on a typed invoice
  const stripDir = words.length >= 2 && DIR_FULL.includes(words[0]) && (words.length >= 3 || !hasSuffix);
  const baseWords = stripDir ? words.slice(1) : words;
  return { num, full, base: baseWords.join(" "), stem: (hasSuffix ? baseWords.slice(0, -1) : baseWords).join(" ").toLowerCase(), hasSuffix };
}

/** The first and last local day of "the last N days, including today". */
export function lastDaysRange(nowMs: number, tz: string, n: number): { from: string; to: string } {
  const to = localDate(new Date(nowMs).toISOString(), tz);
  return { from: addDays(to, -(Math.max(1, Math.floor(n)) - 1)), to };
}

// ---------- The report ----------

const hasXY = (r: TrendRow) => r.lat !== null && r.lng !== null && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng));

export function computeTrends(all: TrendRow[], opts: TrendOptions): Trends {
  const { tz, nowMs } = opts;
  const today = localDate(new Date(nowMs).toISOString(), tz);
  const city = (r: TrendRow): City => (hasXY(r) ? cityOf({ city: r.city, lat: Number(r.lat), lng: Number(r.lng) }) : isCity(r.city) ? r.city : "bozeman");
  const day = (iso: string) => localDate(iso, tz);

  const valid = all.filter((r) => (r.src === "history" || hasXY(r)) && !Number.isNaN(Date.parse(r.reported_at)));
  // the city filter shapes the whole picture; the type filter only narrows what is counted
  const inCity = valid.filter((r) => opts.city === "all" || city(r) === opts.city).sort((a, b) => Date.parse(a.reported_at) - Date.parse(b.reported_at) || a.id - b.id);
  const typeOk = (r: TrendRow) => opts.type === "all" || typeKey(r.gtype) === opts.type;
  const pool = inCity.filter(typeOk);

  const firstTagDay = pool.length ? day(pool[0].reported_at) : null;
  const firstEver = inCity.length ? day(inCity[0].reported_at) : null;
  const to = isYmd(opts.to) ? opts.to : today;
  let from = isYmd(opts.from) ? opts.from : firstTagDay ?? to;
  if (from > to) from = to;
  const days = diffDays(from, to) + 1;
  const rows = pool.filter((r) => {
    const d = day(r.reported_at);
    return d >= from && d <= to;
  });
  const n = rows.length;

  // ----- totals
  const mins = rows.map((r) => r.duration_min).filter((m): m is number => typeof m === "number" && m >= 0);
  const minutes = mins.reduce((a, b) => a + b, 0);
  const removedRows = rows.filter((r) => r.removed_at);
  const openRows = rows.filter((r) => !r.removed_at);
  const totals = {
    tags: n,
    removed: removedRows.length,
    open: openRows.length,
    urgent: rows.filter((r) => r.urgent === true).length,
    perDay: days > 0 ? round1(n / days) : 0,
    minutes,
    avgMin: mins.length ? round1(minutes / mins.length) : null,
    medianMin: median(mins),
    imported: rows.filter((r) => r.src === "history").length,
    unplaced: rows.filter((r) => !hasXY(r)).length,
  };

  // ----- compared with the period just before (only when there is real history that far back)
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const prevAvailable = firstEver !== null && firstEver <= prevFrom;
  const prevTags = prevAvailable
    ? pool.filter((r) => {
        const d = day(r.reported_at);
        return d >= prevFrom && d <= prevTo;
      }).length
    : 0;
  const compare = { available: prevAvailable, prevTags, deltaPct: prevAvailable && prevTags > 0 ? round1(((n - prevTags) / prevTags) * 100) : null };

  // ----- over time
  const unit: "day" | "week" | "month" = days <= 45 ? "day" : days <= 200 ? "week" : "month";
  const bucketOf = (d: string) => (unit === "day" ? d : unit === "week" ? weekStart(d) : monthStart(d));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(bucketOf(day(r.reported_at)), (counts.get(bucketOf(day(r.reported_at))) ?? 0) + 1);
  const points: { key: string; label: string; n: number }[] = [];
  if (unit === "month") {
    for (let k = monthStart(from); k <= to; k = monthStart(addDays(k, 32))) points.push({ key: k, label: fmtMonth(k), n: counts.get(k) ?? 0 });
  } else {
    const step = unit === "day" ? 1 : 7;
    for (let k = bucketOf(from); k <= to; k = addDays(k, step)) points.push({ key: k, label: fmtDay(k), n: counts.get(k) ?? 0 });
  }

  // ----- breakdowns
  const bucketize = (keyOf: (r: TrendRow) => string, labelOf: (k: string) => string = (k) => k): Bucket[] => {
    const m = new Map<string, { n: number; min: number; withMin: number }>();
    for (const r of rows) {
      const k = keyOf(r);
      const e = m.get(k) ?? { n: 0, min: 0, withMin: 0 };
      e.n += 1;
      if (typeof r.duration_min === "number" && r.duration_min >= 0) {
        e.min += r.duration_min;
        e.withMin += 1;
      }
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([key, e]) => ({ key, label: labelOf(key), n: e.n, pct: pctOf(e.n, n), avgMin: e.withMin ? round1(e.min / e.withMin) : null, minutes: e.min }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  };
  const byCity = bucketize((r) => city(r), (k) => (isCity(k) ? { bozeman: "Bozeman", helena: "Helena" }[k] : k));
  const byType = bucketize((r) => typeKey(r.gtype), (k) => TYPE_NAMES[k as keyof typeof TYPE_NAMES] ?? k);
  const bySurface = bucketize((r) => normalizeSurface(r.surface));
  const byChemical = bucketize((r) => normalizeChemical(r.chemical));

  // ----- where: streets, blocks, map points
  type Located = { r: TrendRow; a: Addr | null; c: City };
  // An old invoice says "Main"; the tracker says "East Main Street". When the tracker knows exactly one street with that
  // name ("Main" -> "Main Street"), the invoice's street is counted with it. With two ("Main Street" and "Main Avenue") it is left alone.
  const suffixOf = new Map<string, Set<string>>();
  for (const r of valid) {
    const a = parseAddress(r.address);
    if (a?.hasSuffix) suffixOf.set(a.stem, (suffixOf.get(a.stem) ?? new Set<string>()).add(a.base));
  }
  const withSuffix = (a: Addr | null): Addr | null => {
    if (!a || a.hasSuffix) return a;
    const known = suffixOf.get(a.stem);
    if (!known || known.size !== 1) return a;
    const [base] = [...known];
    const word = base.split(" ").pop() as string;
    return { ...a, base, full: `${a.full} ${word}`, hasSuffix: true };
  };
  const located: Located[] = rows.map((r) => ({ r, a: withSuffix(parseAddress(r.address)), c: city(r) }));

  const streetMap = new Map<string, { label: string; c: City; list: Located[] }>();
  for (const x of located) {
    if (!x.a) continue;
    const k = `${x.c}|${x.a.base}`;
    const e = streetMap.get(k) ?? { label: x.a.base, c: x.c, list: [] };
    e.list.push(x);
    streetMap.set(k, e);
  }
  const streets: StreetBucket[] = [...streetMap.entries()]
    .map(([key, e]) => ({
      key,
      label: e.label,
      city: e.c,
      n: e.list.length,
      pct: pctOf(e.list.length, n),
      last: e.list.reduce((a, x) => (x.r.reported_at > a ? x.r.reported_at : a), ""),
      topType: typeLabel(mode(e.list.map((x) => typeKey(x.r.gtype))) ?? "other"),
    }))
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .slice(0, 10);

  const cellMap = new Map<string, Located[]>();
  for (const x of located) {
    if (!hasXY(x.r)) continue;
    const k = cellKey(Number(x.r.lat), Number(x.r.lng));
    const l = cellMap.get(k);
    if (l) l.push(x);
    else cellMap.set(k, [x]);
  }
  const blocks: HotBlock[] = [...cellMap.entries()]
    .map(([key, list]) => {
      const [lat, lng] = cellCenter(key);
      const withAddr = list.filter((x) => x.a);
      const street = mode(withAddr.map((x) => x.a!.full));
      const nums = withAddr.filter((x) => x.a!.full === street && x.a!.num !== null).map((x) => x.a!.num as number);
      const med = median(nums);
      const lo = med === null ? null : Math.floor(med / 100) * 100;
      const label = street ? (lo === null ? street : `${street}, ${lo === 0 ? "1-99" : `${lo} block`}`) : "Unnamed block";
      return {
        key,
        lat,
        lng,
        bounds: cellBounds(key),
        n: list.length,
        label,
        topType: typeLabel(mode(list.map((x) => typeKey(x.r.gtype))) ?? "other"),
        last: list.reduce((a, x) => (x.r.reported_at > a ? x.r.reported_at : a), ""),
      };
    })
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .slice(0, 10);
  // two grid cells can share a street and hundred: keep them apart in the list
  const seenLabels = new Map<string, number>();
  for (const b of blocks) {
    const k = (seenLabels.get(b.label) ?? 0) + 1;
    seenLabels.set(b.label, k);
    if (k > 1) b.label = `${b.label} (area ${k})`;
  }

  const mapPoints: MapPoint[] = rows.filter(hasXY).map((r) => ({ id: r.id, lat: Number(r.lat), lng: Number(r.lng), c: city(r), t: typeKey(r.gtype), d: day(r.reported_at), a: r.address ? r.address.slice(0, 60) : null }));

  // ----- repeats: spots we cleaned that were tagged again at least a day later
  // Tags within REPEAT_RADIUS_M of a spot's first tag belong to that spot (anchored, so a row of poles never chains together).
  type Site = { lat: number; lng: number; tags: TrendRow[] };
  const sites: Site[] = [];
  const grid = new Map<string, Site[]>();
  const GLAT = 0.0004;
  const GLNG = 0.0006;
  const gk = (r: number, c: number) => `${r}:${c}`;
  const siteOf = new Map<number, Site>();
  for (const r of inCity) {
    if (r.src === "history" || !hasXY(r)) continue; // an old invoice only knows the intersection: too rough to call a spot "tagged again"
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const gr = Math.floor(lat / GLAT);
    const gc = Math.floor(lng / GLNG);
    let found: Site | null = null;
    let bestD = Infinity;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        for (const s of grid.get(gk(gr + dr, gc + dc)) ?? []) {
          const d = meters(s.lat, s.lng, lat, lng);
          if (d <= REPEAT_RADIUS_M && d < bestD) {
            found = s;
            bestD = d;
          }
        }
    if (!found) {
      found = { lat, lng, tags: [] };
      sites.push(found);
      const k = gk(gr, gc);
      const l = grid.get(k);
      if (l) l.push(found);
      else grid.set(k, [found]);
    }
    found.tags.push(r);
    siteOf.set(r.id, found);
  }
  let repeatTags = 0;
  const gaps: number[] = [];
  const repeatsAt = new Map<Site, number>();
  for (const r of rows) {
    const s = siteOf.get(r.id);
    if (!s) continue;
    const t = Date.parse(r.reported_at);
    let lastRemoved = -Infinity;
    for (const e of s.tags) {
      if (e.id === r.id || !e.removed_at) continue;
      const rem = Date.parse(e.removed_at);
      if (rem <= t - REPEAT_AFTER_MS && rem > lastRemoved) lastRemoved = rem;
    }
    if (lastRemoved > -Infinity) {
      repeatTags += 1;
      repeatsAt.set(s, (repeatsAt.get(s) ?? 0) + 1);
      gaps.push((t - lastRemoved) / DAY);
    }
  }
  const repeatSites: RepeatSite[] = sites
    .filter((s) => (repeatsAt.get(s) ?? 0) > 0)
    .map((s) => {
      const ds = [...new Set(s.tags.map((t) => day(t.reported_at)))].sort();
      const withAddr = s.tags.map((t) => parseAddress(t.address)).filter((a): a is Addr => !!a);
      const label = mode(withAddr.map((a) => (a.num !== null ? `${a.num} ${a.full}` : a.full))) ?? "Unnamed spot";
      return {
        label,
        lat: s.lat,
        lng: s.lng,
        tags: s.tags.length,
        days: ds.length,
        firstDay: ds[0],
        lastDay: ds[ds.length - 1],
        typeLabel: typeLabel(mode(s.tags.map((t) => typeKey(t.gtype))) ?? "other"),
      };
    })
    .sort((a, b) => b.days - a.days || b.tags - a.tags || b.lastDay.localeCompare(a.lastDay))
    .slice(0, 8);
  const seenSites = new Map<string, number>();
  for (const s of repeatSites) {
    const k = (seenSites.get(s.label) ?? 0) + 1;
    seenSites.set(s.label, k);
    if (k > 1) s.label = `${s.label} (spot ${k})`;
  }
  const repeat = { tags: repeatTags, pct: n > 0 ? pctOf(repeatTags, n) : null, sites: repeatSites, medianGapDays: median(gaps) === null ? null : round1(median(gaps) as number) };

  // ----- found vs. cleaned: tags that waited, and what is still open
  const waited = removedRows.map((r) => (Date.parse(r.removed_at as string) - Date.parse(r.reported_at)) / DAY).filter((d) => d > 1);
  const openAges = openRows
    .map((r) => ({ id: r.id, label: r.address || typeLabel(r.gtype), days: Math.max(0, Math.floor((nowMs - Date.parse(r.reported_at)) / DAY)) }))
    .sort((a, b) => b.days - a.days || a.id - b.id);
  const lag = {
    later: waited.length,
    medianDays: waited.length ? round1(median(waited) as number) : null,
    open: openRows.length,
    oldestOpenDays: openAges.length ? openAges[0].days : null,
    openList: openAges.slice(0, 5),
  };

  // ----- who handled them
  const crewMap = new Map<string, { n: number; min: number; withMin: number }>();
  for (const r of rows) {
    const k = (r.who ?? "").trim() || "Unassigned";
    const e = crewMap.get(k) ?? { n: 0, min: 0, withMin: 0 };
    e.n += 1;
    if (typeof r.duration_min === "number" && r.duration_min >= 0) {
      e.min += r.duration_min;
      e.withMin += 1;
    }
    crewMap.set(k, e);
  }
  const crew = [...crewMap.entries()]
    .map(([name, e]) => ({ name, n: e.n, minutes: e.min, avgMin: e.withMin ? round1(e.min / e.withMin) : null }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  // ----- plain-English findings (every one guarded by a minimum sample so a handful of tags cannot fake a pattern)
  const insights: Insight[] = [];
  const historyDays = firstEver ? diffDays(firstEver, today) + 1 : 0;
  if (n === 0) {
    insights.push({ level: "note", text: "No tags match these filters. Try a wider date range or all cities." });
  } else {
    if (historyDays < 60) {
      insights.push({
        level: "warn",
        text: `The data only goes back ${plural(historyDays, "day")}${firstEver ? ` (to ${fmtDay(firstEver)})` : ""}. Treat everything here as an early read, not a proven pattern. It gets much more reliable after a few months, and especially after a full year with the seasons.`,
      });
    }
    // A long stretch with no tags at all usually means invoices that were never imported, not a quiet spell: say so,
    // because a gap drags every per-day average down and draws an empty stretch in the chart.
    const dayList = [...new Set(rows.map((r) => day(r.reported_at)))].sort();
    let gapDays = 0;
    let gapFrom = "";
    for (let i = 1; i < dayList.length; i++) {
      const g = diffDays(dayList[i - 1], dayList[i]) - 1;
      if (g > gapDays) {
        gapDays = g;
        gapFrom = addDays(dayList[i - 1], 1);
      }
    }
    if (gapDays >= 14) {
      insights.push({
        level: "warn",
        text: `No tags are recorded from ${fmtDay(gapFrom)} to ${fmtDay(addDays(gapFrom, gapDays - 1))} (${plural(gapDays, "day")} in a row). If that is a stretch of invoices that has not been imported, the per-day average and the chart understate those weeks. Pick a time period that avoids the gap, or import the missing invoices.`,
      });
    }
    let vol = `${plural(n, "tag")} found over ${plural(days, "day")} (${totals.perDay} a day).`;
    if (compare.available && compare.deltaPct !== null) {
      vol += ` That is ${compare.deltaPct === 0 ? "the same as" : `${Math.abs(compare.deltaPct)}% ${compare.deltaPct > 0 ? "more than" : "fewer than"}`} the ${plural(days, "day")} before (${prevTags}).`;
    } else if (!compare.available) {
      vol += " There is not enough earlier history to compare against yet.";
    }
    insights.push({ level: "info", text: vol });

    const perDay = new Map<string, number>();
    for (const r of rows) perDay.set(day(r.reported_at), (perDay.get(day(r.reported_at)) ?? 0) + 1);
    const [topDay, topDayN] = [...perDay.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
    if (n >= 20 && topDayN >= 15 && topDayN / n >= 0.15) {
      insights.push({
        level: "warn",
        text: `${fmtDay(topDay)} alone has ${topDayN} tags (${pctOf(topDayN, n)}%). That looks like one big sweep, so the day-to-day line mostly shows where crews worked, not how much new graffiti appeared.`,
      });
    }

    if (opts.city === "all" && byCity.length > 1) {
      insights.push({ level: "info", text: `${byCity.map((c) => `${c.label}: ${c.n} (${c.pct}%)`).join(" · ")}.` });
    }

    if (streets.length && n >= 10) {
      const t = streets[0];
      const top3 = streets.slice(0, 3).reduce((a, s) => a + s.n, 0);
      insights.push({
        level: "info",
        text: `${t.label} (${t.city === "helena" ? "Helena" : "Bozeman"}) is the hot street: ${plural(t.n, "tag")}, ${t.pct}% of everything${streets.length >= 3 ? `. The top 3 streets together are ${pctOf(top3, n)}%` : ""}.`,
      });
    }
    if (blocks.length && n >= 10 && blocks[0].n >= 5) {
      insights.push({ level: "info", text: `The busiest single block is ${blocks[0].label}, with ${plural(blocks[0].n, "tag")} (mostly ${blocks[0].topType.toLowerCase()}).` });
    }

    if (byType.length) {
      const t = byType[0];
      insights.push({ level: "info", text: `${t.label} is the most common type: ${plural(t.n, "tag")} (${t.pct}%).` });
      const heavy = byType.find((b) => b.n >= 3 && b.minutes > 0 && minutes > 0 && b.minutes / minutes >= 2 * (b.n / n) && b.minutes / minutes >= 0.15);
      if (heavy) {
        insights.push({
          level: "info",
          text: `${heavy.label} is only ${heavy.pct}% of tags but ${pctOf(heavy.minutes, minutes)}% of logged labor time (about ${heavy.avgMin ?? "?"} min each), so it is where the hours go.`,
        });
      }
    }
    const surf = bySurface.find((b) => b.key !== "Not recorded");
    if (surf && n >= 10) insights.push({ level: "info", text: `Most common surface: ${surf.label.toLowerCase()} (${plural(surf.n, "tag")}, ${surf.pct}%).` });

    if (repeat.tags > 0) {
      const top = repeat.sites[0];
      insights.push({
        level: "warn",
        text: `${plural(repeat.tags, "tag")} (${repeat.pct}%) came back to a spot we had already cleaned at least a day earlier${repeat.medianGapDays !== null ? `, typically ${repeat.medianGapDays} days later` : ""}.${top ? ` Most re-hit: ${top.label}, tagged on ${top.days} different days.` : ""}`,
      });
    } else if (historyDays >= 14 && n >= 20) {
      insights.push({ level: "info", text: "No spot has been re-tagged after cleaning yet (counting only tags found a day or more after the previous one was removed)." });
    }

    if (lag.open > 0 || lag.later > 0) {
      const parts: string[] = [];
      if (lag.open > 0) parts.push(`${plural(lag.open, "tag")} still open${lag.oldestOpenDays !== null ? `, the oldest ${plural(lag.oldestOpenDays, "day")}` : ""}`);
      if (lag.later > 0) parts.push(`${plural(lag.later, "tag")} waited more than a day to be removed${lag.medianDays !== null ? ` (typically ${lag.medianDays} days)` : ""}`);
      insights.push({ level: lag.oldestOpenDays !== null && lag.oldestOpenDays >= 7 ? "warn" : "info", text: `${parts.join(" · ")}.` });
    }

    if (mins.length >= 20) {
      const quick = mins.filter((m) => m <= 2).length;
      if (quick / mins.length >= 0.7) {
        insights.push({
          level: "note",
          text: `${pctOf(quick, mins.length)}% of tags are logged at 1-2 minutes (median ${totals.medianMin} min), so minutes only separate the long jobs, like spray paint, from the rest. Total logged labor is about ${round1(minutes / 60)} hours.`,
        });
      }
    }
  }

  return {
    range: { from, to, days, firstTagDay, historyDays },
    totals,
    compare,
    series: { unit, points },
    byCity,
    byType,
    bySurface,
    byChemical,
    streets,
    blocks,
    repeat,
    lag,
    crew,
    points: mapPoints,
    insights,
  };
}

export const TREND_CITIES = CITIES;
