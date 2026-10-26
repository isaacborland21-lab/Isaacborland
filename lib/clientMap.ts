// The live client map: a read-only map of finished graffiti tags that the owner shares with a city by private link.
// Pure functions only (no database, no React) so the server and the page agree.

import { City, InvoiceRow, cityOf, localDate, typeName } from "@/lib/graffiti";
import { monthName, seasonOf } from "@/lib/myMaps";

/** Share links live in graffiti_settings as k = "share:<token>", v = JSON. Removing the row turns the link off. */
export const SHARE_PREFIX = "share:";
export type ShareLink = { token: string; city: City; label: string; created_at: string };

/** 32 url-safe characters (24 random bytes). */
export const isShareToken = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{32}$/.test(v);

export function parseShare(k: string, v: string | null): ShareLink | null {
  if (!k.startsWith(SHARE_PREFIX)) return null;
  const token = k.slice(SHARE_PREFIX.length);
  if (!isShareToken(token) || !v) return null;
  try {
    const o = JSON.parse(v) as Partial<ShareLink>;
    if (o.city !== "bozeman" && o.city !== "helena") return null;
    return { token, city: o.city, label: typeof o.label === "string" ? o.label : "", created_at: typeof o.created_at === "string" ? o.created_at : "" };
  } catch {
    return null;
  }
}

/** One color per calendar month, the same every year (Jan..Dec). Picked to stay apart on a street map. */
export const MONTH_COLORS = [
  "#1f77b4", // Jan
  "#17becf", // Feb
  "#2ca02c", // Mar
  "#7fbf3f", // Apr
  "#bcbd22", // May
  "#ffbf00", // Jun
  "#ff7f0e", // Jul
  "#d62728", // Aug
  "#e377c2", // Sep
  "#9467bd", // Oct
  "#8c564b", // Nov
  "#393b79", // Dec
];

/** What a client sees for one tag: where, when and what. No crew names, notes, photos, times or prices. */
export type PublicTag = { lat: number; lng: number; address: string; day: string; month: string; monthNo: number; season: string; seasonLabel: string; type: string };

export function publicTags(rows: InvoiceRow[], o: { city: City; tz: string }): PublicTag[] {
  return rows
    .filter((r) => r.removed_at && Number.isFinite(r.lat) && Number.isFinite(r.lng) && cityOf(r) === o.city)
    .sort((a, b) => Date.parse(a.removed_at) - Date.parse(b.removed_at) || a.id - b.id)
    .map((r) => {
      const day = localDate(r.removed_at, o.tz);
      const s = seasonOf(day);
      return {
        lat: Math.round(r.lat * 1e6) / 1e6,
        lng: Math.round(r.lng * 1e6) / 1e6,
        address: (r.address ?? "").trim(),
        day,
        month: monthName(day),
        monthNo: Number(day.slice(5, 7)),
        season: s.key,
        seasonLabel: s.label,
        type: typeName(r.gtype, r.gtype_other),
      };
    });
}

/** Seasons that have tags, newest first, with counts. */
export function seasonsOf(tags: PublicTag[]): { key: string; label: string; count: number }[] {
  const m = new Map<string, { label: string; count: number }>();
  for (const t of tags) {
    const e = m.get(t.season) ?? { label: t.seasonLabel, count: 0 };
    e.count += 1;
    m.set(t.season, e);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, e]) => ({ key, ...e }));
}
