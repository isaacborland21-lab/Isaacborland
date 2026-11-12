"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import g from "../graffiti/graffiti.module.css";
import s from "./snow.module.css";
import { LeafletNS, TILE_ATTRIBUTION, TILE_URL, apiJson, loadLeaflet } from "../graffiti/clientUtil";
import { MAX_ROUTE_BYTES, SnowRoute, closestRoute, distanceTo, fmtDistance, fmtSize, sortRoutes } from "@/lib/snow";

// Snow removal: the crew's phone shows where they are on a live map, which route is closest, and the
// route itself (a PDF of Google Maps screenshots with the roads and sidewalks we plow drawn in red).
// Route PDFs are kept on the phone after the first view, so they still open with no signal in a storm.
// The owner adds, renames, pins, replaces and deletes routes from the "Manage routes" box at the bottom.

type Here = { lat: number; lng: number; acc: number };
type Gps = "off" | "wait" | "ok" | "denied" | "none";
type Toast = (msg: string) => void;

const BOZEMAN: [number, number] = [45.679, -111.038];
const ROUTE_KEY = "snow_route";
const LIST_KEY = "snow_routes_cache";
const CACHE_NAME = "snow-routes-v1";
const cacheUrl = (id: string) => `/__snow_cache__/${id}.pdf`;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const readStore = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeStore = (k: string, v: string | null) => {
  try {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch {
    /* private mode: not important */
  }
};
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

// ---------- offline copies of route PDFs (Cache Storage; a route's file never changes, a new upload gets a new id) ----------

async function cacheGet(id: string): Promise<ArrayBuffer | null> {
  try {
    const c = await caches.open(CACHE_NAME);
    const hit = await c.match(cacheUrl(id));
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}
async function cachePut(id: string, bytes: ArrayBuffer) {
  try {
    const c = await caches.open(CACHE_NAME);
    await c.put(cacheUrl(id), new Response(bytes, { headers: { "Content-Type": "application/pdf" } }));
  } catch {
    /* storage full or blocked: the route still shows, it just won't be there offline */
  }
}
async function cacheIds(): Promise<Set<string>> {
  try {
    const c = await caches.open(CACHE_NAME);
    const keys = await c.keys();
    return new Set(keys.map((r) => new URL(r.url).pathname.replace(/^\/__snow_cache__\//, "").replace(/\.pdf$/, "")));
  } catch {
    return new Set();
  }
}
async function cacheDrop(keep: Set<string>) {
  try {
    const c = await caches.open(CACHE_NAME);
    for (const r of await c.keys()) {
      const id = new URL(r.url).pathname.replace(/^\/__snow_cache__\//, "").replace(/\.pdf$/, "");
      if (!keep.has(id)) await c.delete(r);
    }
  } catch {
    /* ignore */
  }
}

/** The route PDF: the copy on this phone if there is one, otherwise downloaded (and then kept). */
async function getRouteBytes(id: string): Promise<{ bytes: ArrayBuffer; fromPhone: boolean }> {
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
type PdfJs = any;
const PDFJS = "https://unpkg.com/pdfjs-dist@3.11.174/build";
let pdfPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
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

/** Phones refuse canvases above ~16 million pixels (iPhone Safari) and draw them blank, so stay under it. */
const MAX_CANVAS_PX = 16_000_000;

// =====================================================================================================

export default function SnowTab({ isOwner, active = true }: { isOwner: boolean; active?: boolean }) {
  const [routes, setRoutes] = useState<SnowRoute[] | null>(null);
  const [owner, setOwner] = useState(isOwner);
  const [listErr, setListErr] = useState<string | null>(null);
  const [offlineList, setOfflineList] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [here, setHere] = useState<Here | null>(null);
  const [gps, setGps] = useState<Gps>("off");
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savingAll, setSavingAll] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null); // label shown while the owner taps the map for a pin
  const pinCb = useRef<((ll: { lat: number; lng: number }) => void) | null>(null);
  const autoPicked = useRef(false);
  const mapAnchor = useRef<HTMLDivElement>(null);

  const toast = useCallback<Toast>((msg) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3200);
  }, []);

  const applyList = useCallback((list: SnowRoute[]) => {
    setRoutes(list);
    writeStore(LIST_KEY, JSON.stringify(list));
    void cacheDrop(new Set(list.map((r) => r.id))).then(() => cacheIds().then(setSaved));
  }, []);

  // the route list (falls back to the copy on this phone with no signal)
  const loadList = useCallback(async () => {
    try {
      const d = await apiJson<{ routes: SnowRoute[]; owner: boolean }>("/api/snow/routes");
      setOwner(d.owner);
      setOfflineList(false);
      setListErr(null);
      applyList(d.routes);
    } catch (e) {
      const raw = readStore(LIST_KEY);
      let cached: SnowRoute[] | null = null;
      try {
        cached = raw ? (JSON.parse(raw) as SnowRoute[]) : null;
      } catch {
        cached = null;
      }
      if (cached) {
        setRoutes(cached);
        setOfflineList(true);
      } else {
        setListErr(errMsg(e));
        setRoutes([]);
      }
    }
  }, [applyList]);

  useEffect(() => {
    setSelId(readStore(ROUTE_KEY));
    void cacheIds().then(setSaved);
    void loadList();
  }, [loadList]);

  // GPS only while the tab is on screen (it costs battery)
  useEffect(() => {
    if (!active) return;
    if (!("geolocation" in navigator)) {
      setGps("none");
      return;
    }
    setGps((g0) => (g0 === "ok" ? g0 : "wait"));
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setHere({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setGps("ok");
      },
      (e) => setGps(e.code === 1 ? "denied" : "wait"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  const sorted = useMemo(() => sortRoutes(routes ?? []), [routes]);
  const selected = sorted.find((r) => r.id === selId) ?? null;
  const closest = useMemo(() => closestRoute(sorted, here), [sorted, here]);

  const pick = useCallback((id: string | null) => {
    setSelId(id);
    writeStore(ROUTE_KEY, id);
  }, []);

  // first visit on this phone: open the closest route (or the only one)
  useEffect(() => {
    if (!routes || autoPicked.current) return;
    if (selId && routes.some((r) => r.id === selId)) {
      autoPicked.current = true;
      return;
    }
    if (routes.length === 1) {
      autoPicked.current = true;
      pick(routes[0].id);
    } else if (closest) {
      autoPicked.current = true;
      pick(closest.route.id);
    }
  }, [routes, selId, closest, pick]);

  const requestPin = useCallback((label: string, cb: (ll: { lat: number; lng: number }) => void) => {
    pinCb.current = cb;
    setPlacing(label);
    mapAnchor.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  const cancelPin = useCallback(() => {
    pinCb.current = null;
    setPlacing(null);
  }, []);
  const onMapTap = useCallback((ll: { lat: number; lng: number }) => {
    const cb = pinCb.current;
    if (!cb) return;
    pinCb.current = null;
    setPlacing(null);
    cb(ll);
  }, []);

  async function saveAll() {
    const todo = sorted.filter((r) => !saved.has(r.id));
    for (let i = 0; i < todo.length; i++) {
      setSavingAll(`Saving ${i + 1} of ${todo.length}…`);
      try {
        await getRouteBytes(todo[i].id);
      } catch (e) {
        setSavingAll(null);
        toast(`Stopped at ${todo[i].name}: ${errMsg(e)}`);
        setSaved(await cacheIds());
        return;
      }
    }
    setSavingAll(null);
    setSaved(await cacheIds());
    toast("All routes are saved on this phone.");
  }

  const gpsChip =
    gps === "ok" && here
      ? { cls: here.acc <= 50 ? s.gpsOk : here.acc <= 300 ? s.gpsWarn : s.gpsBad, text: `GPS ±${fmtDistance(here.acc)}` }
      : gps === "denied"
        ? { cls: s.gpsBad, text: "Location off" }
        : gps === "none"
          ? { cls: s.gpsBad, text: "No GPS" }
          : { cls: s.gpsWarn, text: "Finding you…" };

  const unsaved = sorted.filter((r) => !saved.has(r.id)).length;

  return (
    <section className={g.root} data-testid="snow-tab">
      <div className={g.head}>
        <h2 className={g.title}>Snow removal</h2>
        <span className={`${s.gps} ${gpsChip.cls}`} data-testid="snow-gps">
          {gpsChip.text}
        </span>
      </div>

      {offlineList && <p className={g.note}>No signal. Showing the routes saved on this phone.</p>}
      {listErr && (
        <div className={`${s.status} ${s.err}`} style={{ marginBottom: 12 }}>
          {listErr}{" "}
          <button type="button" className={g.linkbtn} onClick={() => void loadList()}>
            Try again
          </button>
        </div>
      )}

      {routes === null ? (
        <p className={g.empty}>Loading routes…</p>
      ) : sorted.length === 0 && !listErr ? (
        <div className={s.status} data-testid="snow-empty">
          No snow routes yet.{" "}
          {owner ? "Add the first one under Manage routes below." : "Isaac hasn't uploaded them. Check back soon."}
        </div>
      ) : (
        sorted.length > 0 && (
          <>
            <div className={s.picker}>
              <select aria-label="Snow route" data-testid="snow-route-select" value={selected?.id ?? ""} onChange={(e) => pick(e.target.value || null)}>
                <option value="">Choose a route…</option>
                {sorted.map((r) => {
                  const d = distanceTo(r, here);
                  return (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {d !== null ? ` · ${fmtDistance(d)}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            {closest && closest.route.id !== selected?.id && (
              <div className={s.closest} data-testid="snow-closest">
                <p>
                  Closest to you: <b>{closest.route.name}</b> ({fmtDistance(closest.meters)})
                </p>
                <button type="button" className={g.btn} onClick={() => pick(closest.route.id)}>
                  Open it
                </button>
              </div>
            )}
            {gps === "denied" && (
              <p className={g.note} style={{ textAlign: "left" }}>
                Location is blocked for this site, so the map can't show where you are. Pick your route from the list, or turn location on in
                your browser settings.
              </p>
            )}
          </>
        )
      )}

      <div className={s.section} ref={mapAnchor}>
        <div className={s.sectionHead}>
          <h3>Where you are</h3>
        </div>
        <LiveMap
          active={active}
          routes={sorted}
          selectedId={selected?.id ?? null}
          here={here}
          placing={placing}
          onSelect={pick}
          onTap={onMapTap}
          onCancelPlacing={cancelPin}
        />
      </div>

      {selected && (
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h3>Snow route</h3>
          </div>
          <p className={s.routeName} data-testid="snow-route-name">
            {selected.name}
          </p>
          <p className={s.routeMeta}>
            Updated {fmtDay(selected.uploaded_at)}
            {(() => {
              const d = distanceTo(selected, here);
              return d !== null ? ` · ${fmtDistance(d)} away` : "";
            })()}
          </p>
          {selected.notes && <p className={s.routeNotes}>{selected.notes}</p>}
          <RouteViewer
            key={selected.id}
            route={selected}
            active={active}
            isSaved={saved.has(selected.id)}
            onSaved={() => void cacheIds().then(setSaved)}
          />
        </div>
      )}

      {sorted.length > 1 && (
        <div className={s.section}>
          <button type="button" className={`${g.btn} ${g.sec} ${g.block}`} disabled={!!savingAll || unsaved === 0} onClick={() => void saveAll()} data-testid="snow-save-all">
            {savingAll ?? (unsaved === 0 ? "All routes are saved on this phone" : `Save all ${sorted.length} routes for no-signal use`)}
          </button>
        </div>
      )}

      {owner && <ManageRoutes routes={sorted} here={here} toast={toast} onList={applyList} requestPin={requestPin} onUploaded={(id) => pick(id)} />}

      {toastMsg && (
        <div className={g.toast} role="status">
          {toastMsg}
        </div>
      )}
    </section>
  );
}

// =====================================================================================================
// Live map: the phone's position (blue dot + accuracy ring) and a red label for each pinned route.

function LiveMap({
  active,
  routes,
  selectedId,
  here,
  placing,
  onSelect,
  onTap,
  onCancelPlacing,
}: {
  active: boolean;
  routes: SnowRoute[];
  selectedId: string | null;
  here: Here | null;
  placing: string | null;
  onSelect: (id: string) => void;
  onTap: (ll: { lat: number; lng: number }) => void;
  onCancelPlacing: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS>(null);
  const LRef = useRef<LeafletNS>(null);
  const pinsRef = useRef<LeafletNS>(null);
  const youRef = useRef<{ dot: LeafletNS; ring: LeafletNS } | null>(null);
  const centered = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!active || mapRef.current) return;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !box.current || mapRef.current) return;
        const map = L.map(box.current, { minZoom: 3 }).setView(BOZEMAN, 13);
        L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
        pinsRef.current = L.layerGroup().addTo(map);
        map.on("click", (e: { latlng: { lat: number; lng: number } }) => tapRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
        LRef.current = L;
        mapRef.current = map;
        setReady(true);
      })
      .catch((e) => !cancelled && setErr(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [active]);

  // the tab can be hidden and shown again (crew page): Leaflet needs to re-measure its box
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => mapRef.current?.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  // route labels
  useEffect(() => {
    const L = LRef.current;
    const layer = pinsRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    const pinned = routes.filter((r) => r.lat !== null && r.lng !== null);
    for (const r of pinned) {
      const on = r.id === selectedId;
      const span = document.createElement("span");
      span.textContent = r.name;
      const icon = L.divIcon({ className: `snow-pin${on ? " on" : ""}`, html: span.outerHTML, iconSize: [0, 0] });
      L.marker([r.lat, r.lng], { icon, zIndexOffset: on ? 1000 : 0, keyboard: true, title: r.name })
        .on("click", () => selectRef.current(r.id))
        .addTo(layer);
    }
    if (!centered.current && pinned.length > 0 && !here) {
      mapRef.current.fitBounds(
        pinned.map((r) => [r.lat, r.lng]),
        { padding: [40, 40], maxZoom: 15 },
      );
    }
  }, [ready, routes, selectedId, here]);

  // you are here
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || !here) return;
    const ll: [number, number] = [here.lat, here.lng];
    if (!youRef.current) {
      const ring = L.circle(ll, { radius: here.acc, color: "#2b7cff", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
      const dot = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2b7cff", fillOpacity: 1, interactive: false }).addTo(map);
      youRef.current = { dot, ring };
    } else {
      youRef.current.dot.setLatLng(ll);
      youRef.current.ring.setLatLng(ll).setRadius(here.acc);
    }
    if (!centered.current) {
      centered.current = true;
      map.setView(ll, Math.max(map.getZoom(), 15));
    }
  }, [ready, here]);

  function centerOnMe() {
    if (here && mapRef.current) mapRef.current.setView([here.lat, here.lng], Math.max(mapRef.current.getZoom(), 16));
  }

  return (
    <div className={s.mapWrap}>
      <div ref={box} className={s.snowMap} data-testid="snow-map" role="application" aria-label="Map of where you are and the snow routes. Tap a route label to open it." />
      {err && <div className={g.mapErr}>{err}</div>}
      {placing && (
        <div className={s.placing} data-testid="snow-placing">
          <span>{placing}</span>
          <button type="button" onClick={onCancelPlacing}>
            Cancel
          </button>
        </div>
      )}
      {here && ready && (
        <button type="button" className={s.mapBtn} onClick={centerOnMe}>
          Center on me
        </button>
      )}
    </div>
  );
}

// =====================================================================================================
// Route PDF: every page drawn on the screen, with zoom and a full-screen mode for reading in the truck.

function RouteViewer({ route, active, isSaved, onSaved }: { route: SnowRoute; active: boolean; isSaved: boolean; onSaved: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfJs>(null);
  const [state, setState] = useState<{ kind: "loading" | "ready" | "error"; msg?: string }>({ kind: "loading" });
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const renderToken = useRef(0);
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

  // download (or read from the phone) and open the PDF
  useEffect(() => {
    if (!active && !docRef.current) return;
    if (docRef.current) return;
    let cancelled = false;
    let url: string | null = null;
    setState({ kind: "loading", msg: isSaved ? "Opening route…" : `Downloading route${route.size ? ` (${fmtSize(route.size)})` : ""}…` });
    (async () => {
      const [{ bytes, fromPhone }, pdfjs] = await Promise.all([getRouteBytes(route.id), loadPdfJs()]);
      if (cancelled) return;
      if (!fromPhone) savedRef.current();
      url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setBlobUrl(url);
      // pdf.js takes ownership of the buffer it is given, so hand it a copy
      const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
      if (cancelled) {
        void doc.destroy();
        return;
      }
      docRef.current = doc;
      setState({ kind: "ready" });
    })().catch((e) => !cancelled && setState({ kind: "error", msg: errMsg(e) }));
    return () => {
      cancelled = true;
      if (url && !docRef.current) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.id, active, attempt]);

  useEffect(
    () => () => {
      void docRef.current?.destroy?.();
      docRef.current = null;
    },
    [],
  );
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl]);

  // follow the box width (rotating the phone, full screen, the tab being shown again)
  useEffect(() => {
    const el = pagesRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let t = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setWidth(el.clientWidth), 120);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [state.kind, full]);

  // draw the pages
  useEffect(() => {
    const doc = docRef.current;
    const el = pagesRef.current;
    if (state.kind !== "ready" || !doc || !el || width < 50) return;
    const token = ++renderToken.current;
    const keepX = el.scrollWidth > el.clientWidth ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5;
    const keepY = el.scrollHeight > el.clientHeight ? (el.scrollTop + el.clientHeight / 2) / el.scrollHeight : 0;
    (async () => {
      const cssWidth = Math.floor((width - 2) * zoom);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const canvases: HTMLCanvasElement[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        if (token !== renderToken.current) return;
        const base = page.getViewport({ scale: 1 });
        const cssScale = cssWidth / base.width;
        let px = cssScale * dpr;
        const area = base.width * base.height * px * px;
        if (area > MAX_CANVAS_PX) px *= Math.sqrt(MAX_CANVAS_PX / area);
        const vp = page.getViewport({ scale: px });
        const cv = document.createElement("canvas");
        cv.width = Math.floor(vp.width);
        cv.height = Math.floor(vp.height);
        cv.style.width = `${cssWidth}px`;
        cv.style.height = `${Math.floor(base.height * cssScale)}px`;
        cv.setAttribute("aria-label", `${route.name}, page ${n} of ${doc.numPages}`);
        cv.setAttribute("role", "img");
        const ctx = cv.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (token !== renderToken.current) return;
        canvases.push(cv);
      }
      el.replaceChildren(...canvases);
      el.scrollLeft = Math.max(0, keepX * el.scrollWidth - el.clientWidth / 2);
      el.scrollTop = Math.max(0, keepY * el.scrollHeight - el.clientHeight / 2);
    })().catch((e) => token === renderToken.current && setState({ kind: "error", msg: `Could not show this PDF: ${errMsg(e)}` }));
  }, [state.kind, width, zoom, route.name]);

  // Escape leaves full screen
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const zoomTo = (z: number) => setZoom(Math.max(1, Math.min(5, Math.round(z * 100) / 100)));

  return (
    <div className={full ? s.full : undefined} data-testid="snow-viewer">
      <div className={s.toolbar}>
        <button type="button" className={`${g.btn} ${g.sec} ${s.zoom}`} aria-label="Zoom out" disabled={state.kind !== "ready" || zoom <= 1} onClick={() => zoomTo(zoom / 1.5)}>
          −
        </button>
        <span className={s.zoomVal} data-testid="snow-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className={`${g.btn} ${g.sec} ${s.zoom}`} aria-label="Zoom in" disabled={state.kind !== "ready" || zoom >= 5} onClick={() => zoomTo(zoom * 1.5)}>
          +
        </button>
        {zoom > 1 && (
          <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => setZoom(1)}>
            Fit
          </button>
        )}
        <span className={s.spacer} />
        {isSaved && !full && <span className={s.saved}>Saved on phone</span>}
        <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => setFull((f) => !f)} disabled={state.kind !== "ready"} data-testid="snow-full">
          {full ? "Close" : "Full screen"}
        </button>
        {blobUrl && !full && (
          <a className={`${g.btn} ${g.sec}`} href={blobUrl} target="_blank" rel="noopener" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", minHeight: 44, padding: "8px 12px" }}>
            Open PDF
          </a>
        )}
      </div>
      {state.kind !== "ready" && (
        <div className={`${s.status} ${state.kind === "error" ? s.err : ""}`} data-testid="snow-viewer-status">
          {state.msg}
          {state.kind === "error" && (
            <>
              {" "}
              <button type="button" className={g.linkbtn} onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </>
          )}
        </div>
      )}
      <div ref={pagesRef} className={s.pages} hidden={state.kind !== "ready"} data-testid="snow-pages" />
    </div>
  );
}

// =====================================================================================================
// Owner only: add a route (name, PDF, optional pin), and rename / move pin / replace / delete existing ones.

type PinValue = { lat: number; lng: number } | null;

/** Uploads straight to storage with the one-time link from the server, reporting progress. */
function putFile(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("cacheControl", "31536000");
    form.append("", new Blob([file], { type: "application/pdf" }), file.name || "route.pdf");
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The upload was refused (${xhr.status}). Try again.`)));
    xhr.onerror = () => reject(new Error("The upload stopped. Check your connection and try again."));
    xhr.send(form);
  });
}

async function uploadRoute(
  file: File,
  fields: { name: string; notes: string; pin: PinValue },
  replaces: string | null,
  onProgress: (pct: number) => void,
): Promise<{ route: SnowRoute; routes: SnowRoute[] }> {
  if (file.type && file.type !== "application/pdf") throw new Error("Choose a PDF file.");
  if (file.size > MAX_ROUTE_BYTES) throw new Error(`That PDF is ${fmtSize(file.size)}. The limit is ${fmtSize(MAX_ROUTE_BYTES)}.`);
  const json = { "Content-Type": "application/json" };
  const start = await apiJson<{ id: string; uploadUrl: string }>("/api/snow/routes", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ name: fields.name, size: file.size, replaces }),
  });
  await putFile(start.uploadUrl, file, onProgress);
  return apiJson<{ route: SnowRoute; routes: SnowRoute[] }>(`/api/snow/routes/${start.id}`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ name: fields.name, notes: fields.notes, lat: fields.pin?.lat ?? null, lng: fields.pin?.lng ?? null, replaces }),
  });
}

function PinPicker({
  value,
  onChange,
  here,
  requestPin,
  label,
}: {
  value: PinValue;
  onChange: (v: PinValue) => void;
  here: Here | null;
  requestPin: (label: string, cb: (ll: { lat: number; lng: number }) => void) => void;
  label: string;
}) {
  return (
    <>
      <p className={s.pinLine} data-testid="snow-pin-line">
        {value ? `Pin set at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : "No pin. Crews can still pick it from the list, but it won't show on the map or as closest."}
      </p>
      <div className={s.pinBtns}>
        <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => requestPin(`Tap the map where ${label} is`, (ll) => onChange(ll))}>
          Tap the map
        </button>
        <button type="button" className={`${g.btn} ${g.sec}`} disabled={!here} onClick={() => here && onChange({ lat: here.lat, lng: here.lng })}>
          Use my location
        </button>
        {value && (
          <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => onChange(null)}>
            Remove pin
          </button>
        )}
      </div>
    </>
  );
}

function ManageRoutes({
  routes,
  here,
  toast,
  onList,
  requestPin,
  onUploaded,
}: {
  routes: SnowRoute[];
  here: Here | null;
  toast: Toast;
  onList: (list: SnowRoute[]) => void;
  requestPin: (label: string, cb: (ll: { lat: number; lng: number }) => void) => void;
  onUploaded: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState<PinValue>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(routes.length === 0);

  async function add() {
    setErr(null);
    if (!name.trim()) return setErr("Give the route a name.");
    if (!file) return setErr("Choose the route PDF.");
    setPct(0);
    try {
      const d = await uploadRoute(file, { name, notes, pin }, null, setPct);
      onList(d.routes);
      onUploaded(d.route.id);
      setName("");
      setNotes("");
      setPin(null);
      setFile(null);
      setFileKey((k) => k + 1);
      toast(`${d.route.name} added.`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setPct(null);
    }
  }

  return (
    <details className={s.manage} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="snow-manage">
      <summary>Manage routes (only you see this)</summary>
      <div className={s.manageBody}>
        <div className={s.box}>
          <h4>Add a route</h4>
          <label className={g.lbl} htmlFor="snow-new-name">
            Name<span className={g.req}> *</span>
          </label>
          <input id="snow-new-name" type="text" maxLength={80} placeholder="e.g. Route 3, Main St sidewalks" value={name} onChange={(e) => setName(e.target.value)} />
          <label className={g.lbl} htmlFor="snow-new-file">
            Route PDF<span className={g.req}> *</span>
          </label>
          <input
            key={fileKey}
            id="snow-new-file"
            className={s.fileIn}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="snow-new-file"
          />
          {file && <p className={s.pinLine}>{fmtSize(file.size)}</p>}
          <label className={g.lbl} htmlFor="snow-new-notes">
            Notes for the crew (optional)
          </label>
          <textarea id="snow-new-notes" rows={2} maxLength={500} placeholder="e.g. Sidewalks by 7am. Skip the alley behind the library." value={notes} onChange={(e) => setNotes(e.target.value)} />
          <span className={g.lbl}>Map pin (optional)</span>
          <PinPicker value={pin} onChange={setPin} here={here} requestPin={requestPin} label={name.trim() || "this route"} />
          {pct !== null && (
            <div className={s.progress} aria-label={`Uploading ${pct}%`}>
              <div style={{ width: `${pct}%` }} />
            </div>
          )}
          {err && <p className={s.formErr}>{err}</p>}
          <button type="button" className={`${g.btn} ${g.block}`} style={{ marginTop: 12 }} disabled={pct !== null} onClick={() => void add()} data-testid="snow-add">
            {pct !== null ? (pct < 100 ? `Uploading… ${pct}%` : "Checking the file…") : "Add route"}
          </button>
        </div>

        {routes.map((r) => (
          <RouteRow key={r.id} route={r} here={here} toast={toast} onList={onList} requestPin={requestPin} />
        ))}
      </div>
    </details>
  );
}

function RouteRow({
  route,
  here,
  toast,
  onList,
  requestPin,
}: {
  route: SnowRoute;
  here: Here | null;
  toast: Toast;
  onList: (list: SnowRoute[]) => void;
  requestPin: (label: string, cb: (ll: { lat: number; lng: number }) => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(route.name);
  const [notes, setNotes] = useState(route.notes ?? "");
  const [pin, setPin] = useState<PinValue>(route.lat !== null && route.lng !== null ? { lat: route.lat, lng: route.lng } : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setName(route.name);
    setNotes(route.notes ?? "");
    setPin(route.lat !== null && route.lng !== null ? { lat: route.lat, lng: route.lng } : null);
  }, [route, editing]);

  async function save() {
    setErr(null);
    setBusy("Saving…");
    try {
      const d = await apiJson<{ routes: SnowRoute[] }>(`/api/snow/routes/${route.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, notes, lat: pin?.lat ?? null, lng: pin?.lng ?? null }),
      });
      onList(d.routes);
      setEditing(false);
      toast("Saved.");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function replace(file: File) {
    setErr(null);
    try {
      setBusy("Uploading… 0%");
      const d = await uploadRoute(file, { name: route.name, notes: route.notes ?? "", pin }, route.id, (p) => setBusy(p < 100 ? `Uploading… ${p}%` : "Checking the file…"));
      onList(d.routes);
      toast(`${route.name}: new PDF is live.`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirmDel) {
      setConfirmDel(true);
      window.setTimeout(() => setConfirmDel(false), 4000);
      return;
    }
    setErr(null);
    setBusy("Deleting…");
    try {
      const d = await apiJson<{ routes: SnowRoute[] }>(`/api/snow/routes/${route.id}`, { method: "DELETE" });
      onList(d.routes);
      toast(`${route.name} deleted.`);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(null);
    }
  }

  return (
    <div className={s.box} data-testid="snow-row">
      {editing ? (
        <>
          <label className={g.lbl} htmlFor={`snow-name-${route.id}`}>
            Name
          </label>
          <input id={`snow-name-${route.id}`} type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <label className={g.lbl} htmlFor={`snow-notes-${route.id}`}>
            Notes for the crew
          </label>
          <textarea id={`snow-notes-${route.id}`} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <span className={g.lbl}>Map pin</span>
          <PinPicker value={pin} onChange={setPin} here={here} requestPin={requestPin} label={name.trim() || route.name} />
          {err && <p className={s.formErr}>{err}</p>}
          <div className={s.actions}>
            <button type="button" className={g.btn} disabled={!!busy} onClick={() => void save()}>
              {busy ?? "Save"}
            </button>
            <button type="button" className={`${g.btn} ${g.sec}`} disabled={!!busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <h4>{route.name}</h4>
          <p className={s.pinLine}>
            {fmtSize(route.size)} · uploaded {fmtDay(route.uploaded_at)} · {route.lat !== null ? "pinned on map" : "no pin"}
          </p>
          {err && <p className={s.formErr}>{err}</p>}
          <div className={s.actions}>
            <button type="button" className={`${g.btn} ${g.sec}`} disabled={!!busy} onClick={() => setEditing(true)}>
              Edit
            </button>
            <label className={`${g.btn} ${g.sec} ${s.replaceLbl}`} aria-disabled={!!busy}>
              {busy && busy !== "Deleting…" ? busy : "Replace PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void replace(f);
                }}
              />
            </label>
            <button type="button" className={`${g.btn} ${g.danger}`} disabled={!!busy} onClick={() => void remove()} data-testid="snow-delete">
              {busy === "Deleting…" ? busy : confirmDel ? "Tap again to delete" : "Delete"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
