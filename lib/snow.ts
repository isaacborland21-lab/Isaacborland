// Pure logic for the Snow removal tab (route maps for the plow crews). No database, no Next.js:
// the API routes, the tab and the tests all share this file, so keep it safe to load in the browser.
//
// A "route" is one PDF the owner uploads (usually Google Maps screenshots with the roads and sidewalks we
// plow drawn in red), plus a name and an optional pin. The pin is what lets the crew page say which
// route is closest to the phone.
//
// A route can also have "stops": one per PDF page, titled from the big heading at the top of the page
// (read automatically when the PDF is uploaded, e.g. "Tinworks Art", "Story Mill Community Center Lot").
// A stop with a map pin lets the crew page say "You're at Tinworks Art" and jump to that page. The list of routes is a small JSON file kept next to the PDFs in a
// private storage bucket, so this feature needs no new database table.

export const SNOW_BUCKET = "snow";
/** Where the list of routes is kept inside the bucket. */
export const ROUTES_FILE = "routes.json";
/** Route PDFs are stored as routes/<id>.pdf. */
export const routePath = (id: string) => `routes/${id}.pdf`;

/** Supabase's free plan refuses anything over 50 MB per file; stay under it with room to spare. */
export const MAX_ROUTE_BYTES = 45 * 1024 * 1024;
export const MAX_ROUTES = 100;
export const MAX_NAME = 80;
export const MAX_NOTES = 500;
export const MAX_STOPS = 200;
export const MAX_STOP_TITLE = 120;
/** Within this distance of a pinned stop, the phone counts as "at" it and the route jumps to its page. */
export const AT_STOP_M = 150;
/** A pin farther than this from the phone isn't called "closest" (you're probably not on any route). */
export const CLOSEST_LIMIT_M = 8000;

export const ROUTE_ID_RE = /^[a-f0-9]{24}$/;

export type SnowRoute = {
  id: string;
  name: string;
  notes: string | null;
  size: number;
  uploaded_at: string;
  uploaded_by_name: string | null;
  lat: number | null;
  lng: number | null;
  /** One per page that has a heading, in page order. Older routes may have none. */
  stops: SnowStop[];
};

export type SnowStop = { page: number; title: string; lat: number | null; lng: number | null };

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

type SnowMeta = { owner?: boolean; tabAdmin?: Record<string, boolean | undefined> } | null | undefined;

/**
 * May open the Snow removal tab: the owner, and anyone given the "snow removal" switch in the Admin tab
 * (its own switch, separate from the job roles). Only the owner can add, change or delete routes.
 */
export function canUseSnow(meta: SnowMeta): boolean {
  if (!meta) return false;
  return meta.owner === true || meta.tabAdmin?.snow === true;
}

export function cleanName(v: unknown): Ok<{ name: string }> | Fail {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!s) return { ok: false, error: "Give the route a name, like Route 3 or Downtown sidewalks." };
  if (s.length > MAX_NAME) return { ok: false, error: `Keep the name under ${MAX_NAME} characters.` };
  return { ok: true, name: s };
}

export function cleanNotes(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, MAX_NOTES);
  return s || null;
}

/** Both blank = no pin. Otherwise both must be real coordinates. */
export function cleanPin(lat: unknown, lng: unknown): Ok<{ lat: number | null; lng: number | null }> | Fail {
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  if (blank(lat) && blank(lng)) return { ok: true, lat: null, lng: null };
  if (blank(lat) || blank(lng)) return { ok: false, error: "That pin location isn't valid. Place it again on the map." };
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) {
    return { ok: false, error: "That pin location isn't valid. Place it again on the map." };
  }
  return { ok: true, lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 };
}

/** Stop titles: no markdown-ish asterisks, single spaces, a sane length. */
export function cleanStopTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\*+/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_STOP_TITLE).trim();
  return s || null;
}

/** Validates the stops list sent by the browser. Pages must be whole numbers, each used once. */
export function cleanStops(v: unknown): Ok<{ stops: SnowStop[] }> | Fail {
  if (v === undefined || v === null) return { ok: true, stops: [] };
  if (!Array.isArray(v)) return { ok: false, error: "The stop list isn't valid. Reload and try again." };
  if (v.length > MAX_STOPS) return { ok: false, error: `A route can have at most ${MAX_STOPS} stops.` };
  const seen = new Set<number>();
  const out: SnowStop[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "The stop list isn't valid. Reload and try again." };
    const o = raw as Record<string, unknown>;
    const page = Number(o.page);
    if (!Number.isInteger(page) || page < 1 || page > 1000 || seen.has(page)) return { ok: false, error: "The stop list isn't valid. Reload and try again." };
    const title = cleanStopTitle(o.title);
    if (!title) return { ok: false, error: `Give the stop on page ${page} a name.` };
    const pin = cleanPin(o.lat, o.lng);
    if (!pin.ok) return { ok: false, error: `The pin for "${title}" isn't valid. Place it again.` };
    seen.add(page);
    out.push({ page, title, lat: pin.lat, lng: pin.lng });
  }
  out.sort((a, b) => a.page - b.page);
  return { ok: true, stops: out };
}

/** One piece of text on a PDF page: its size and how far down the page it sits (0 = top). */
export type PdfTextBit = { str: string; size: number; top: number; left: number };

/**
 * The page's heading: the biggest text in the top half of the page. Starting from the first line at that
 * size, it takes the lines straight below it that are just as big (a two-line title), and stops at the
 * first smaller line, so big text further down the page isn't swept in.
 * Returns null for pages with no real text (just pictures, or only a page number).
 */
export function headingFromText(bits: PdfTextBit[], pageHeight: number): string | null {
  const words = bits.filter((b) => b.str.trim() && !/^\s*\d{1,3}\s*$/.test(b.str) && b.size > 0 && b.top <= pageHeight * 0.85);
  const top = words.filter((b) => b.top <= pageHeight * 0.5);
  if (top.length === 0) return null;
  const biggest = Math.max(...top.map((b) => b.size));
  const isBig = (b: PdfTextBit) => b.size >= biggest * 0.9;

  // group every word into lines, top to bottom
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: { top: number; bits: PdfTextBit[] }[] = [];
  for (const b of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(b.top - last.top) <= Math.max(2, b.size * 0.35)) last.bits.push(b);
    else lines.push({ top: b.top, bits: [b] });
  }
  const first = lines.findIndex((l) => l.top <= pageHeight * 0.5 && l.bits.some(isBig));
  if (first < 0) return null;
  const picked: string[] = [];
  let prevTop = lines[first].top;
  for (let i = first; i < lines.length; i++) {
    const l = lines[i];
    if (!l.bits.every(isBig) && i > first) break;
    if (i > first && l.top - prevTop > biggest * 2) break;
    picked.push(l.bits.filter(isBig).sort((a, b) => a.left - b.left).map((b) => b.str).join(" "));
    prevTop = l.top;
    if (picked.length >= 3) break;
  }
  const text = picked.join(" · ").replace(/\s+·\s+(?=\()/g, " ");
  return cleanStopTitle(text);
}

/** What to type into a map search for a stop: "1902–1908 W. Koch lot" → "1902 W. Koch". */
export function searchText(title: string): string {
  let s = title.split(" · ").pop() ?? title;
  s = s.replace(/\([^)]*\)/g, " ");
  // "Pete's House & Neighbor- 4527 & 4507 Graf St": a street address in the title is the best thing to search
  const addr = s.match(/\b\d{2,5}\s*(?:[–—-]\s*\d+)?\s*(?:&\s*\d+\s*)?[A-Za-z].*$/);
  if (addr) s = addr[0];
  s = s.replace(/(\d+)\s*[–—-]\s*\d+/g, "$1");
  s = s.replace(/\b(\d+)\s*&\s*\d+\b/g, "$1");
  s = s.replace(/\b(lot|lots|sidewalks?|driveways?|parking|tri\/duplexes|duplexes|triplexes)\b/gi, " ");
  s = s.replace(/[*–—-]+\s*$/g, " ");
  return s.replace(/\s+/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "");
}

/** Every pinned spot for a route: its own pin and its stops' pins. */
export function routePoints(route: SnowRoute): { lat: number; lng: number; stop: SnowStop | null }[] {
  const pts: { lat: number; lng: number; stop: SnowStop | null }[] = [];
  if (route.lat !== null && route.lng !== null) pts.push({ lat: route.lat, lng: route.lng, stop: null });
  for (const s of route.stops) if (s.lat !== null && s.lng !== null) pts.push({ lat: s.lat, lng: s.lng, stop: s });
  return pts;
}

/** Reads routes.json defensively: anything malformed is dropped rather than breaking the tab. */
export function parseRoutes(raw: unknown): SnowRoute[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { routes?: unknown }).routes) ? (raw as { routes: unknown[] }).routes : [];
  const out: SnowRoute[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || !ROUTE_ID_RE.test(o.id) || seen.has(o.id)) continue;
    const name = cleanName(o.name);
    if (!name.ok) continue;
    const pin = cleanPin(o.lat, o.lng);
    seen.add(o.id);
    out.push({
      id: o.id,
      name: name.name,
      notes: cleanNotes(o.notes),
      size: typeof o.size === "number" && o.size > 0 ? Math.round(o.size) : 0,
      uploaded_at: typeof o.uploaded_at === "string" ? o.uploaded_at : new Date(0).toISOString(),
      uploaded_by_name: typeof o.uploaded_by_name === "string" ? o.uploaded_by_name.slice(0, 80) : null,
      lat: pin.ok ? pin.lat : null,
      lng: pin.ok ? pin.lng : null,
      stops: (() => {
        const st = cleanStops(o.stops);
        return st.ok ? st.stops : [];
      })(),
    });
  }
  return out;
}

/** Route 2 before Route 10. */
export function sortRoutes(routes: SnowRoute[]): SnowRoute[] {
  return [...routes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

/** Straight-line distance in meters (good enough across a city). */
export function metersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distance to the nearest pinned spot of a route (its pin or any stop), or null if nothing is pinned. */
export function distanceTo(route: SnowRoute, here: { lat: number; lng: number } | null): number | null {
  if (!here) return null;
  let best: number | null = null;
  for (const p of routePoints(route)) {
    const d = metersBetween(here.lat, here.lng, p.lat, p.lng);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** The pinned stop the phone is at (within AT_STOP_M), across all routes; the selected route wins ties. */
export function stopHere(
  routes: SnowRoute[],
  here: { lat: number; lng: number } | null,
  preferRouteId: string | null = null,
): { route: SnowRoute; stop: SnowStop; meters: number } | null {
  if (!here) return null;
  let best: { route: SnowRoute; stop: SnowStop; meters: number } | null = null;
  for (const r of routes) {
    for (const s of r.stops) {
      if (s.lat === null || s.lng === null) continue;
      const d = metersBetween(here.lat, here.lng, s.lat, s.lng);
      if (d > AT_STOP_M) continue;
      const better = !best || d < best.meters - 10 || (Math.abs(d - best.meters) <= 10 && r.id === preferRouteId);
      if (better) best = { route: r, stop: s, meters: d };
    }
  }
  return best;
}

/** The pinned route nearest the phone, if one is within CLOSEST_LIMIT_M. */
export function closestRoute(routes: SnowRoute[], here: { lat: number; lng: number } | null): { route: SnowRoute; meters: number } | null {
  let best: { route: SnowRoute; meters: number } | null = null;
  for (const r of routes) {
    const d = distanceTo(r, here);
    if (d !== null && d <= CLOSEST_LIMIT_M && (!best || d < best.meters)) best = { route: r, meters: d };
  }
  return best;
}

/** US crews: feet up close, miles beyond. */
export function fmtDistance(m: number): string {
  const feet = m * 3.28084;
  if (feet < 1000) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  const mi = m / 1609.344;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Does this look like a PDF? (first bytes are "%PDF-", sometimes after a little junk) */
export function looksLikePdf(head: Uint8Array): boolean {
  const s = String.fromCharCode(...Array.from(head.subarray(0, 1024)));
  return s.includes("%PDF-");
}
