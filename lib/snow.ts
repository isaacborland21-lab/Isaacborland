// Pure logic for the Snow removal tab (route maps for the plow crews). No database, no Next.js:
// the API routes, the tab and the tests all share this file, so keep it safe to load in the browser.
//
// A "route" is one PDF the owner uploads (usually Google Maps screenshots with the roads and sidewalks we
// plow drawn in red), plus a name and an optional pin. The pin is what lets the crew page say which
// route is closest to the phone. The list of routes is a small JSON file kept next to the PDFs in a
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
};

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

export function distanceTo(route: SnowRoute, here: { lat: number; lng: number } | null): number | null {
  if (!here || route.lat === null || route.lng === null) return null;
  return metersBetween(here.lat, here.lng, route.lat, route.lng);
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
