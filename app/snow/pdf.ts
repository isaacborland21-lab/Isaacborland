"use client";

// PDF helpers for the Snow removal tab: keeping route PDFs on the phone, loading PDF.js, and reading each
// page's heading so a route PDF turns into a list of stops (one per property page).

import { apiJson } from "../graffiti/clientUtil";
import { PdfTextBit, SnowStop, headingFromText } from "@/lib/snow";

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

// ---------- copies on the phone (Cache Storage; a route's file never changes, a new upload gets a new id) ----------

const CACHE_NAME = "snow-routes-v1";
const cacheUrl = (id: string) => `/__snow_cache__/${id}.pdf`;
const idOf = (url: string) => new URL(url).pathname.replace(/^\/__snow_cache__\//, "").replace(/\.pdf$/, "");

async function cacheGet(id: string): Promise<ArrayBuffer | null> {
  try {
    const hit = await (await caches.open(CACHE_NAME)).match(cacheUrl(id));
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}
export async function cachePut(id: string, bytes: ArrayBuffer) {
  try {
    await (await caches.open(CACHE_NAME)).put(cacheUrl(id), new Response(bytes, { headers: { "Content-Type": "application/pdf" } }));
  } catch {
    /* storage full or blocked: the route still shows, it just won't be kept */
  }
}
export async function cacheIds(): Promise<Set<string>> {
  try {
    const keys = await (await caches.open(CACHE_NAME)).keys();
    return new Set(keys.map((r) => idOf(r.url)));
  } catch {
    return new Set();
  }
}
export async function cacheDrop(keep: Set<string>) {
  try {
    const c = await caches.open(CACHE_NAME);
    for (const r of await c.keys()) if (!keep.has(idOf(r.url))) await c.delete(r);
  } catch {
    /* ignore */
  }
}

/** The route PDF: the copy on this phone if there is one, otherwise downloaded (and then kept). */
export async function getRouteBytes(id: string): Promise<{ bytes: ArrayBuffer; fromPhone: boolean }> {
  const saved = await cacheGet(id);
  if (saved) return { bytes: saved, fromPhone: true };
  const { url } = await apiJson<{ url: string }>(`/api/snow/routes/${id}/pdf`);
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("No connection, and this route isn't saved on this phone yet.");
  }
  if (!res.ok) throw new Error(`Could not download the route (${res.status}). Try again.`);
  const bytes = await res.arrayBuffer();
  await cachePut(id, bytes);
  return { bytes, fromPhone: false };
}

// ---------- PDF.js (loaded on demand, like Leaflet) ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
export type PdfJs = any;
const PDFJS = "https://unpkg.com/pdfjs-dist@3.11.174/build";
let pdfPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  const w = window as unknown as { pdfjsLib?: PdfJs };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (pdfPromise) return pdfPromise;
  pdfPromise = new Promise<PdfJs>((resolve, reject) => {
    const js = document.createElement("script");
    js.src = `${PDFJS}/pdf.min.js`;
    js.crossOrigin = "anonymous";
    js.onload = () => {
      if (!w.pdfjsLib) return reject(new Error("The route viewer did not start."));
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
      resolve(w.pdfjsLib);
    };
    js.onerror = () => {
      pdfPromise = null;
      js.remove();
      reject(new Error("The route viewer could not load (check your connection)."));
    };
    document.head.appendChild(js);
  });
  return pdfPromise;
}

/**
 * Reads a route PDF: its title and one stop per page that has a heading ("Tinworks Art", "1515 S Black Ave").
 * Pins are left empty; the owner places them (or uses Find on map).
 */
export async function readPdfStops(bytes: ArrayBuffer): Promise<{ title: string | null; pages: number; stops: SnowStop[] }> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  const doc = await task.promise;
  try {
    const stops: SnowStop[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const bits: PdfTextBit[] = (tc.items as any[])
        .filter((i) => typeof i?.str === "string" && Array.isArray(i.transform))
        .map((i) => ({ str: i.str, size: Math.hypot(i.transform[2], i.transform[3]), top: vp.height - i.transform[5], left: i.transform[4] }));
      const title = headingFromText(bits, vp.height);
      if (title) stops.push({ page: n, title, lat: null, lng: null });
    }
    let title: string | null = null;
    try {
      const meta = await doc.getMetadata();
      const t = typeof meta?.info?.Title === "string" ? meta.info.Title.trim() : "";
      title = t && !/^untitled/i.test(t) ? t : null;
    } catch {
      title = null;
    }
    return { title: title ?? stops.find((s) => s.page === 1)?.title ?? null, pages: doc.numPages, stops };
  } finally {
    void task.destroy?.(); // every pdf.js version has this on the loading task
  }
}

/**
 * Keeps pins when a route's PDF is replaced: a page whose heading matches an old stop's name keeps that
 * stop's pin and name (pages can move around between versions). New or renamed pages start unpinned.
 */
export function carryOverStops(next: SnowStop[], old: SnowStop[]): SnowStop[] {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byTitle = new Map(old.map((s) => [norm(s.title), s]));
  return next.map((s) => {
    const prev = byTitle.get(norm(s.title));
    return prev ? { ...s, title: prev.title, lat: prev.lat, lng: prev.lng } : s;
  });
}

// ---------- finding a stop on the map (OpenStreetMap search, free, no key) ----------

/** Best match for a place name near a point, or null. One request per call: callers space them out (1/second). */
export async function findPlace(q: string, near: { lat: number; lng: number }): Promise<{ lat: number; lng: number; label: string } | null> {
  const box = [near.lng - 0.3, near.lat + 0.2, near.lng + 0.3, near.lat - 0.2].map((v) => v.toFixed(4)).join(",");
  const tries = [
    `q=${encodeURIComponent(q)}&viewbox=${box}&bounded=1`,
    `q=${encodeURIComponent(q + ", Montana")}`,
  ];
  for (const t of tries) {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&${t}`, { headers: { Accept: "application/json" } });
    if (!res.ok) continue;
    const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (hits.length) {
      const lat = Number(hits[0].lat);
      const lng = Number(hits[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, label: hits[0].display_name.split(",").slice(0, 3).join(",") };
    }
  }
  return null;
}
