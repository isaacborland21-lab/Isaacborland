// Export of finished graffiti tags for Google My Maps (the free shared pin maps).
// My Maps has no API, so the owner downloads a CSV and imports it as a layer.
// Bozeman: one layer per calendar season. Helena: one layer per year.
// Pure functions only (no database, no React).

import { City, InvoiceRow, chemicalOf, cityOf, csvSafe, localDate, typeName } from "@/lib/graffiti";

// ---------- Seasons ----------
// Calendar seasons: Spring Mar-May, Summer Jun-Aug, Fall Sep-Nov, Winter Dec-Feb.
// Winter crosses the new year: Dec 2026 + Jan/Feb 2027 are "Winter 2026-27" (key 2026-4-winter).

export const SEASONS = ["spring", "summer", "fall", "winter"] as const;
export type Season = (typeof SEASONS)[number];
const SEASON_NAME: Record<Season, string> = { spring: "Spring", summer: "Summer", fall: "Fall", winter: "Winter" };
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The season a local day (YYYY-MM-DD) falls in. `key` sorts in time order: 2026-1-spring < 2026-4-winter < 2027-1-spring. */
export function seasonOf(ymd: string): { key: string; label: string; season: Season; year: number } {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  let season: Season;
  let year = y;
  if (m >= 3 && m <= 5) season = "spring";
  else if (m >= 6 && m <= 8) season = "summer";
  else if (m >= 9 && m <= 11) season = "fall";
  else {
    season = "winter";
    if (m <= 2) year = y - 1; // Jan/Feb belong to the winter that started the December before
  }
  const n = SEASONS.indexOf(season) + 1;
  const label = season === "winter" ? `Winter ${year}-${String(year + 1).slice(2)}` : `${SEASON_NAME[season]} ${year}`;
  return { key: `${year}-${n}-${season}`, label, season, year };
}

export const isSeasonKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-[1-4]-(spring|summer|fall|winter)$/.test(v) && SEASONS[Number(v[5]) - 1] === v.slice(7);
export const isYear = (v: unknown): v is string => typeof v === "string" && /^20\d{2}$/.test(v);

/** Label for a season key ("2026-4-winter" -> "Winter 2026-27"). */
export function seasonLabel(key: string): string {
  const year = Number(key.slice(0, 4));
  const season = key.slice(7) as Season;
  return season === "winter" ? `Winter ${year}-${String(year + 1).slice(2)}` : `${SEASON_NAME[season]} ${year}`;
}

/** "Dec 2026" for a local day. */
export const monthName = (ymd: string) => `${MONTH_SHORT[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;

// ---------- Picking the tags ----------

export type MyMapsPick = { kind: "season"; key: string } | { kind: "year"; year: string };

/** Finished tags in one city for a season or a calendar year (local days in tz), oldest first. */
export function pickTags(rows: InvoiceRow[], o: { city: City; tz: string; pick: MyMapsPick }): (InvoiceRow & { day: string })[] {
  return rows
    .filter((r) => r.removed_at && Number.isFinite(r.lat) && Number.isFinite(r.lng) && cityOf(r) === o.city)
    .map((r) => ({ ...r, day: localDate(r.removed_at, o.tz) }))
    .filter((r) => (o.pick.kind === "season" ? seasonOf(r.day).key === o.pick.key : r.day.slice(0, 4) === o.pick.year))
    .sort((a, b) => Date.parse(a.removed_at) - Date.parse(b.removed_at) || a.id - b.id);
}

/** Every season and year that has finished tags in this city, newest first, with how many. */
export function availablePeriods(rows: InvoiceRow[], o: { city: City; tz: string }) {
  const seasons = new Map<string, number>();
  const years = new Map<string, number>();
  for (const r of rows) {
    if (!r.removed_at || cityOf(r) !== o.city) continue;
    const day = localDate(r.removed_at, o.tz);
    const s = seasonOf(day).key;
    seasons.set(s, (seasons.get(s) ?? 0) + 1);
    years.set(day.slice(0, 4), (years.get(day.slice(0, 4)) ?? 0) + 1);
  }
  return {
    seasons: [...seasons.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, count]) => ({ key, label: seasonLabel(key), count })),
    years: [...years.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([year, count]) => ({ year, count })),
  };
}

// ---------- CSV for My Maps ----------

/** My Maps imports at most 2,000 rows per layer. */
export const MYMAPS_MAX_ROWS = 2000;

function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per tag. My Maps: tick Latitude + Longitude as the location and "Name" as the title,
 * then "Group places by: Month" to color the pins by month.
 */
export function buildMyMapsCsv(tags: (InvoiceRow & { day: string })[]): string {
  const head = ["Name", "Latitude", "Longitude", "Month", "Season", "Date", "Address", "Tag type", "Surface", "Chemical", "Crew", "Minutes on site", "Tag #", "Notes"];
  const rows: (string | number | null)[][] = [head];
  for (const r of tags) {
    const place = (r.address ?? "").trim();
    rows.push([
      csvSafe(place || `Tag #${r.id}`),
      // numbers on purpose (not through csvSafe, which would quote a negative longitude)
      Number(r.lat.toFixed(6)),
      Number(r.lng.toFixed(6)),
      monthName(r.day),
      seasonOf(r.day).label,
      r.day,
      csvSafe(place),
      csvSafe(typeName(r.gtype, r.gtype_other)),
      csvSafe(r.surface),
      csvSafe(chemicalOf(r)),
      csvSafe(r.done_by),
      r.duration_min,
      r.id,
      csvSafe(r.notes),
    ]);
  }
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
