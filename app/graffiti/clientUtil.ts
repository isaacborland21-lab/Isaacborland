// Browser-only helpers for the graffiti tracker (never import from a server file).
import { MAX_PHOTO_BYTES } from "@/lib/graffiti";

export const photoUrl = (name: string | null | undefined) =>
  name ? `/api/graffiti/photo/${encodeURIComponent(name)}` : null;

/** fetch + JSON with friendly errors (offline, expired sign-in, server messages). */
export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("No connection. Check your signal and try again.");
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  // A signed-out session gets bounced to the sign-in page (HTML), not an API error.
  if (!isJson) throw new Error(res.ok ? "Your session expired. Reload the page and sign in again." : `Request failed (${res.status}).`);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data as T;
}

// ---------- Leaflet (loaded on demand from unpkg, pinned to 1.9.4 with the official integrity hashes) ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
export type LeafletNS = any;
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
const LEAFLET_CSS_SRI = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS_SRI = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
let leafletPromise: Promise<LeafletNS> | null = null;

export function loadLeaflet(): Promise<LeafletNS> {
  const w = window as unknown as { L?: LeafletNS };
  if (w.L) return Promise.resolve(w.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise<LeafletNS>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${LEAFLET}.css`;
    css.integrity = LEAFLET_CSS_SRI;
    css.crossOrigin = "";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = `${LEAFLET}.js`;
    js.integrity = LEAFLET_JS_SRI;
    js.crossOrigin = "";
    js.onload = () => (w.L ? resolve(w.L) : reject(new Error("The map library did not start.")));
    js.onerror = () => {
      leafletPromise = null; // allow a retry
      css.remove();
      js.remove();
      reject(new Error("The map could not load (check your connection)."));
    };
    document.head.appendChild(js);
  });
  return leafletPromise;
}

export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = "&copy; OpenStreetMap";

// ---------- Photos ----------

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  try {
    // applies the phone's rotation so pictures never come out sideways
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((ok, bad) => {
        img.onload = () => ok();
        img.onerror = () => bad(new Error("Could not read that photo. Try taking it again."));
        img.src = url;
      });
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }
}

/**
 * Shrinks a phone photo to at most 1600px on the long side and re-saves it as a JPEG. That keeps uploads
 * small on a weak signal (and under the host's request size limit) and strips the GPS data hidden in the file.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const img = await decode(file);
  try {
    if (!img.width || !img.height) throw new Error("Could not read that photo. Try taking it again.");
    for (const [max, quality] of [[1600, 0.82], [1280, 0.7], [960, 0.6]] as const) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't process photos.");
      ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", quality));
      if (blob && blob.size <= MAX_PHOTO_BYTES) return blob;
    }
    throw new Error("That photo is too large to upload.");
  } finally {
    img.done();
  }
}

// ---------- Auto location: GPS -> nearest intersection ----------

const meters = (a: number, b: number, c: number, d: number) => {
  const x = ((d - b) * Math.cos((((a + c) / 2) * Math.PI) / 180) * 111320);
  const y = (c - a) * 110540;
  return Math.hypot(x, y);
};

type OverpassWay = { type: string; nodes?: number[]; geometry?: { lat: number; lon: number }[]; tags?: { name?: string } };

/** Closest corner where two differently named streets meet ("Near A & B" when the pin is >60 m from it). */
async function nearestIntersection(lat: number, lng: number): Promise<string | null> {
  const q = `[out:json][timeout:12];way(around:120,${lat},${lng})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"]["name"];out body geom;`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q),
    });
    if (!res.ok) throw new Error("overpass " + res.status);
    const j = (await res.json()) as { elements?: OverpassWay[] };
    const nodes = new Map<number, { names: Set<string>; lat: number; lng: number }>();
    for (const w of j.elements ?? []) {
      if (w.type !== "way" || !w.nodes || !w.geometry || !w.tags?.name) continue;
      const name = w.tags.name;
      w.nodes.forEach((id, k) => {
        const g = w.geometry![k];
        if (!g) return;
        let n = nodes.get(id);
        if (!n) {
          n = { names: new Set<string>(), lat: g.lat, lng: g.lon };
          nodes.set(id, n);
        }
        n.names.add(name);
      });
    }
    let best: { names: Set<string>; lat: number; lng: number } | null = null;
    let bd = Infinity;
    nodes.forEach((n) => {
      if (n.names.size < 2) return;
      const d = meters(lat, lng, n.lat, n.lng);
      if (d < bd) {
        bd = d;
        best = n;
      }
    });
    if (!best) return null;
    const label = [...(best as { names: Set<string> }).names].sort().slice(0, 2).join(" & ");
    return bd > 60 ? "Near " + label : label;
  } finally {
    clearTimeout(timer);
  }
}

async function nearestStreet(lat: number, lng: number): Promise<string | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`);
  if (!res.ok) return null;
  const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
  const road = a.road || a.pedestrian || a.footway;
  return road ? (a.house_number ? a.house_number + " " : "") + road : null;
}

/** Best label for a spot, or null (never throws). Free OpenStreetMap services, no API keys. */
export async function lookupPlace(lat: number, lng: number): Promise<string | null> {
  let label: string | null = null;
  try {
    label = await nearestIntersection(lat, lng);
  } catch {
    /* fall through to the street lookup */
  }
  if (!label) {
    try {
      label = await nearestStreet(lat, lng);
    } catch {
      /* give up quietly; the crew types it */
    }
  }
  return label;
}
