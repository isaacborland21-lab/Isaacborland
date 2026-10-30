// Patrol tracking and coverage ("where have crews been, and where has nobody looked lately").
// Pure functions only (no database, no React) so the phone, the server and the tests agree.

import { City, autoCity } from "@/lib/graffiti";

// ---------- The coverage grid ----------
// A fixed grid over the whole map: cells about 300 m x 300 m (3-4 city blocks) at Bozeman / Helena's latitude.
export const CELL_LAT = 0.0027; // ~300 m north-south
export const CELL_LNG = 0.0039; // ~300 m east-west at 45.7 N

export const cellOf = (lat: number, lng: number) => ({ r: Math.floor(lat / CELL_LAT), c: Math.floor(lng / CELL_LNG) });
export const cellKey = (lat: number, lng: number) => {
  const { r, c } = cellOf(lat, lng);
  return `${r}:${c}`;
};
export const isCellKey = (v: unknown): v is string => typeof v === "string" && /^-?\d{1,6}:-?\d{1,6}$/.test(v);
/** South-west and north-east corners of a cell, for drawing it. */
export function cellBounds(key: string): [[number, number], [number, number]] {
  const [r, c] = key.split(":").map(Number);
  return [
    [r * CELL_LAT, c * CELL_LNG],
    [(r + 1) * CELL_LAT, (c + 1) * CELL_LNG],
  ];
}
export function cellCenter(key: string): [number, number] {
  const [[a, b], [c, d]] = cellBounds(key);
  return [(a + c) / 2, (b + d) / 2];
}
export const cellCity = (key: string): City => {
  const [lat, lng] = cellCenter(key);
  return autoCity(lat, lng);
};

/** The area drawn on the coverage map for each city (roughly the city limits plus a margin). Cells outside are only drawn if visited. */
export const CITY_BOX: Record<City, { s: number; w: number; n: number; e: number }> = {
  bozeman: { s: 45.635, w: -111.1, n: 45.71, e: -110.99 },
  helena: { s: 46.56, w: -112.08, n: 46.63, e: -111.98 },
};
export function cellsInBox(city: City): string[] {
  const b = CITY_BOX[city];
  const lo = cellOf(b.s, b.w);
  const hi = cellOf(b.n, b.e);
  const out: string[] = [];
  for (let r = lo.r; r <= hi.r; r++) for (let c = lo.c; c <= hi.c; c++) out.push(`${r}:${c}`);
  return out;
}

// ---------- Patrol points ----------

export type PatrolPoint = { lat: number; lng: number; at: string; acc?: number | null };

/** Distance in metres (good enough at city scale). */
export function meters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const x = (bLng - aLng) * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180) * 111_320;
  const y = (bLat - aLat) * 110_540;
  return Math.hypot(x, y);
}

/** The phone records a point after moving this far (so a parked truck doesn't record anything). */
export const RECORD_EVERY_M = 80;
/** GPS fixes worse than this are ignored. */
export const MAX_ACCURACY_M = 75;
/** Two points further apart in time or distance than this are not joined (the phone was paused or GPS jumped). */
export const JOIN_MAX_S = 240;
export const JOIN_MAX_M = 1500;
/** Faster than this between two points is a GPS glitch, not a truck (40 m/s = 90 mph). */
export const MAX_SPEED_MS = 40;

/** May two consecutive points be joined into a driven line? */
export function joinable(a: PatrolPoint, b: PatrolPoint): boolean {
  const dt = (Date.parse(b.at) - Date.parse(a.at)) / 1000;
  if (!(dt > 0) || dt > JOIN_MAX_S) return false;
  const d = meters(a.lat, a.lng, b.lat, b.lng);
  return d <= JOIN_MAX_M && d / dt <= MAX_SPEED_MS;
}

/**
 * Every grid cell a patrol passed through, with the last time it was there.
 * Points are joined into lines where they are close in time and space, and the line is walked in 50 m steps,
 * so a cell the truck drove straight through counts even with no point inside it.
 */
export function cellsVisited(points: PatrolPoint[]): Map<string, string> {
  const out = new Map<string, string>();
  const mark = (lat: number, lng: number, at: string) => {
    const k = cellKey(lat, lng);
    const prev = out.get(k);
    if (!prev || prev < at) out.set(k, at);
  };
  const pts = points.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    mark(p.lat, p.lng, p.at);
    const q = pts[i + 1];
    if (!q || !joinable(p, q)) continue;
    const steps = Math.ceil(meters(p.lat, p.lng, q.lat, q.lng) / 50);
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      mark(p.lat + (q.lat - p.lat) * f, p.lng + (q.lng - p.lng) * f, q.at);
    }
  }
  return out;
}

/** Split a person's points into drawable lines (a gap in time or a GPS jump starts a new line). */
export function toLines(points: PatrolPoint[]): [number, number][][] {
  const pts = points.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const lines: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && !joinable(pts[i - 1], pts[i])) {
      if (cur.length > 1) lines.push(cur);
      cur = [];
    }
    cur.push([pts[i].lat, pts[i].lng]);
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

/** Checks one point sent by a phone. `nowMs` lets the tests pin the clock. */
export function cleanPoint(v: unknown, nowMs: number): PatrolPoint | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  const acc = o.acc === undefined || o.acc === null ? null : Number(o.acc);
  const at = typeof o.at === "string" ? Date.parse(o.at) : Number(o.at);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (acc !== null && (!Number.isFinite(acc) || acc > MAX_ACCURACY_M)) return null;
  // not from the future (5 min of clock slack) and not older than a day (a phone that was offline a long time)
  if (!Number.isFinite(at) || at > nowMs + 5 * 60_000 || at < nowMs - 24 * 3_600_000) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, at: new Date(at).toISOString(), acc: acc === null ? null : Math.round(acc) };
}

// ---------- Coverage ----------

export type CoverageCell = {
  key: string;
  /** last time a crew drove through or logged a tag here (null = never) */
  last: string | null;
  lastBy: string | null;
  /** finished tags here in the last 365 days */
  tags: number;
  /** a recognisable name for the spot: the most recent tag's address */
  place?: string | null;
};

/** Staleness buckets for the map colors: 0 = today ... 5 = over 30 days, null = never. */
export const STALE_STEPS = [1, 3, 7, 14, 30] as const;
export const STALE_COLORS = ["#1a9850", "#66bd63", "#d9ef8b", "#fee08b", "#fc8d59", "#d73027"];
export const NEVER_COLOR = "#9aa0a6";
export const STALE_LABELS = ["Today / yesterday", "2-3 days", "4-7 days", "8-14 days", "15-30 days", "Over 30 days"];

export function daysSince(last: string | null, nowMs: number): number | null {
  if (!last) return null;
  return Math.max(0, Math.floor((nowMs - Date.parse(last)) / 86_400_000));
}
export function staleBucket(days: number | null): number | null {
  if (days === null) return null;
  const i = STALE_STEPS.findIndex((s) => days <= s);
  return i === -1 ? STALE_STEPS.length : i;
}

/**
 * Where to look next: cells with a history of tags that nobody has covered for a while.
 * score = tags in the last year x days since last covered (never covered counts as 60 days).
 */
export function priorities(cells: CoverageCell[], nowMs: number, limit = 10) {
  return cells
    .filter((c) => c.tags > 0)
    .map((c) => {
      const d = daysSince(c.last, nowMs);
      return { ...c, days: d, score: c.tags * Math.min(d ?? 60, 60) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || b.tags - a.tags || (a.key < b.key ? -1 : 1))
    .slice(0, limit);
}

// ---------- Crew colors ----------

const CREW_COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46c0c9", "#f032e6", "#9a6324", "#808000", "#000075"];
/** The same color for a person every time (hash of the name). */
export function crewColor(name: string | null | undefined): string {
  const s = (name ?? "").trim().toLowerCase();
  if (!s) return "#6b7280";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CREW_COLORS[h % CREW_COLORS.length];
}

/** How long patrol tracks are kept before they are deleted. */
export const KEEP_DAYS = 90;

/**
 * Patrolling (the "Start patrolling" switch, drive routes on the map and the Coverage link) is paused for now.
 * Nothing is deleted: the code, the API and the saved tracks stay as they are. To bring it back, set the
 * environment variable NEXT_PUBLIC_PATROL=on (Vercel -> Settings -> Environment Variables) and redeploy.
 */
export const PATROL_ENABLED = process.env.NEXT_PUBLIC_PATROL === "on";
