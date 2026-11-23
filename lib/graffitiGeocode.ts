// Finding a map position for an intersection written on an old invoice ("Main & N Rouse").
// The lookups themselves run in the browser (see the import page); this file only builds the questions and
// reads the answers, so it can be tested without a network.
//
// An intersection is found by asking OpenStreetMap (Overpass) for the point where a way called A and a way called B meet.
// A position is only accepted when it is unambiguous: if the two streets cross in more than one place (a street that
// curves, or a name shared by two streets) the row is left without a position instead of guessing.

import { City, CITY_NAMES } from "@/lib/graffiti";
import { cityBox } from "@/lib/graffitiImport";

const DIR_WORDS = ["north", "south", "east", "west", "n", "s", "e", "w", "ne", "nw", "se", "sw"];
const SUFFIX_WORDS = ["street", "st", "avenue", "ave", "av", "drive", "dr", "lane", "ln", "boulevard", "blvd", "road", "rd", "court", "ct", "place", "pl", "highway", "hwy", "circle", "cir", "parkway", "pkwy", "trail", "trl", "way", "loop"];

/** "Main & N Rouse" -> ["Main", "N Rouse"]. A single street / address gives one part. */
export function splitIntersection(raw: string): string[] {
  return raw
    .replace(/\s+/g, " ")
    .split(/\s*(?:&|\band\b|\/|@|\bat\b|\bx\b)\s*/i)
    .map((s) => s.replace(/[.,]+$/g, "").trim())
    .filter(Boolean);
}

/** The street's own name without the direction or suffix: "N Rouse Ave" -> "Rouse". */
export function streetCore(raw: string): string {
  const words = raw.replace(/[.,]/g, " ").replace(/^\d+[A-Za-z]?\s+/, "").split(/\s+/).filter(Boolean);
  while (words.length > 1 && DIR_WORDS.includes(words[0].toLowerCase()) && !(words.length === 2 && SUFFIX_WORDS.includes(words[1].toLowerCase()))) words.shift(); // "North Avenue" is a street, not a direction
  while (words.length > 1 && SUFFIX_WORDS.includes(words[words.length - 1].toLowerCase())) words.pop();
  while (words.length > 1 && DIR_WORDS.includes(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(" ");
}

/** Letters, digits, spaces, apostrophes and hyphens only: nothing that needs escaping inside an Overpass string. */
const safe = (s: string) => s.replace(/[^A-Za-z0-9 '-]/g, "").replace(/\s+/g, " ").trim();

/** A regular expression (for OpenStreetMap's name tag) that matches "Rouse", "North Rouse Avenue", "N Rouse Ave" ... */
export function nameRegex(core: string): string {
  const dirs = `(${DIR_WORDS.join("|")})[.]? `;
  const suf = `( (${SUFFIX_WORDS.join("|")})[.]?)?`;
  const tail = `( (north|south|east|west|n|s|e|w)[.]?)?`;
  return `^(${dirs})?${safe(core)}${suf}${tail}$`;
}

/** The Overpass question: every point shared by a road matching streetA and a road matching streetB, inside the city's box. */
export function overpassQuery(city: City, a: string, b: string): string | null {
  const ca = safe(streetCore(a));
  const cb = safe(streetCore(b));
  if (!ca || !cb || ca.toLowerCase() === cb.toLowerCase()) return null;
  const bx = cityBox(city);
  const box = `${bx.lat[0]},${bx.lng[0]},${bx.lat[1]},${bx.lng[1]}`;
  return `[out:json][timeout:25];way["highway"]["name"~"${nameRegex(ca)}",i](${box})->.a;way["highway"]["name"~"${nameRegex(cb)}",i](${box})->.b;node(w.a)(w.b);out 20;`;
}

type OverpassJson = { elements?: { type?: string; lat?: number; lon?: number }[] };

const meters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dy = (bLat - aLat) * 111320;
  const dx = (bLng - aLng) * 111320 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
};

export type Found = { ok: true; lat: number; lng: number } | { ok: false; why: "none" | "several" };

/**
 * The shared points found -> one position. Points within 60 m of each other are one crossing (the two sides of a
 * divided road, or a few nodes at one junction) and are averaged. Two crossings further apart are ambiguous.
 */
export function pickPosition(json: unknown): Found {
  const els = ((json as OverpassJson)?.elements ?? []).filter((e) => e.type === "node" && Number.isFinite(e.lat) && Number.isFinite(e.lon)) as { lat: number; lon: number }[];
  if (els.length === 0) return { ok: false, why: "none" };
  const first = els[0];
  if (els.some((e) => meters(first.lat, first.lon, e.lat, e.lon) > 60)) return { ok: false, why: "several" };
  const lat = els.reduce((s, e) => s + e.lat, 0) / els.length;
  const lng = els.reduce((s, e) => s + e.lon, 0) / els.length;
  return { ok: true, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/** A single address with a house number ("123 N Main St") is asked of Nominatim instead. */
export function nominatimUrl(city: City, address: string): string {
  const bx = cityBox(city);
  const q = `${address}, ${CITY_NAMES[city]}, Montana`;
  return `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=2&countrycodes=us&viewbox=${bx.lng[0]},${bx.lat[1]},${bx.lng[1]},${bx.lat[0]}&bounded=1&q=${encodeURIComponent(q)}`;
}

export function pickNominatim(json: unknown, city: City): Found {
  const list = Array.isArray(json) ? (json as { lat?: string; lon?: string }[]) : [];
  const pts = list.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (pts.length === 0) return { ok: false, why: "none" };
  if (pts.length > 1 && meters(pts[0].lat, pts[0].lng, pts[1].lat, pts[1].lng) > 150) return { ok: false, why: "several" };
  const bx = cityBox(city);
  const p = pts[0];
  if (p.lat < bx.lat[0] || p.lat > bx.lat[1] || p.lng < bx.lng[0] || p.lng > bx.lng[1]) return { ok: false, why: "none" };
  return { ok: true, lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
}

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
