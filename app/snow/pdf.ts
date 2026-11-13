"use client";

// PDF helpers for the Snow removal tab: keeping route PDFs on the phone, loading PDF.js, and reading each
// page's heading so a route PDF turns into a list of stops (one per property page).

import { apiJson } from "../graffiti/clientUtil";
import { PdfTextBit, SnowStop, headingFromText } from "@/lib/snow";
import { Block, InkMask, Rect, layoutPage } from "@/lib/snowLayout";

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

// ---------- the "big view": split a page into instruction text and pictures ----------

type Matrix = [number, number, number, number, number, number];
const mul = (a: Matrix, b: number[]): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/** Where each picture sits on the page (points from the top-left), read from the page's drawing commands. */
async function pictureRects(pdfjs: PdfJs, page: PdfJs, vp: PdfJs): Promise<Rect[]> {
  const OPS = pdfjs.OPS;
  if (!OPS) return [];
  const ops = await page.getOperatorList();
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter((v) => v !== undefined));
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const out: Rect[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform && args?.length >= 6) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) && args[0].length >= 6) ctm = mul(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (paint.has(fn)) {
      const m = ctm;
      const pts = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => vp.convertToViewportPoint(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]) as [number, number]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      out.push({ left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) });
    }
  }
  return out;
}

/** A small black-and-white copy of the page: which spots have anything drawn on them. */
async function inkMask(page: PdfJs): Promise<InkMask | null> {
  const scale = 0.5;
  const vp = page.getViewport({ scale });
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.floor(vp.width));
  cv.height = Math.max(1, Math.floor(vp.height));
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const data = new Uint8Array(cv.width * cv.height);
    for (let i = 0, j = 0; j < data.length; i += 4, j++) {
      if (px[i + 3] > 20 && (px[i] < 236 || px[i + 1] < 236 || px[i + 2] < 236)) data[j] = 1;
    }
    return { w: cv.width, h: cv.height, scale, data };
  } catch {
    return null;
  } finally {
    cv.width = cv.height = 0;
  }
}

export type PageLayout = { width: number; height: number; blocks: Block[] };

/**
 * Works out the big view of one page. Never throws: if anything about the page can't be read, the result has
 * no blocks and the viewer shows the whole page as it is.
 */
export async function analyzePage(pdfjs: PdfJs, doc: PdfJs, n: number): Promise<PageLayout> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  try {
    const tc = await page.getTextContent();
    const bits: PdfTextBit[] = (tc.items as any[])
      .filter((i) => typeof i?.str === "string" && Array.isArray(i.transform))
      .map((i) => {
        const [left, top] = vp.convertToViewportPoint(i.transform[4], i.transform[5]) as [number, number];
        return { str: i.str, size: Math.hypot(i.transform[2], i.transform[3]), top, left, width: typeof i.width === "number" ? i.width : undefined, font: i.fontName };
      });
    const images = await pictureRects(pdfjs, page, vp).catch(() => [] as Rect[]);
    const ink = await inkMask(page);
    return { width: vp.width, height: vp.height, blocks: layoutPage({ width: vp.width, height: vp.height, bits, images, ink }) };
  } catch {
    return { width: vp.width, height: vp.height, blocks: [] };
  }
}
