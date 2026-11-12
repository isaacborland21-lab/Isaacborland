"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import g from "../graffiti/graffiti.module.css";
import s from "./snow.module.css";
import { LeafletNS, TILE_ATTRIBUTION, TILE_URL, apiJson, loadLeaflet } from "../graffiti/clientUtil";
import { SnowRoute, SnowStop, closestRoute, distanceTo, fmtDistance, metersBetween, routePoints, sortRoutes, stopHere } from "@/lib/snow";
import { cacheDrop, cacheIds, errMsg, getRouteBytes } from "./pdf";
import RouteViewer, { Jump } from "./RouteViewer";
import ManageRoutes, { Here, LatLng } from "./ManageRoutes";

// Snow removal: the crew's phone shows where they are on a live map, which route is closest, and the
// route itself (a PDF of Google Maps screenshots with the roads and sidewalks we plow drawn in red).
// A route PDF with one page per property becomes a list of stops; once the owner pins them, the page for
// the property the crew just pulled up to opens by itself ("You're at Tinworks Art").
// Route PDFs are kept on the phone after the first view, so they still open with weak or no signal.

type Gps = "off" | "wait" | "ok" | "denied" | "none";
type Toast = (msg: string) => void;

const BOZEMAN: [number, number] = [45.679, -111.038];
const ROUTE_KEY = "snow_route";
const LIST_KEY = "snow_routes_cache";

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
/** Short name for map labels: the last part of a long heading ("Plow AFTER 10AM … · Pete's House …" → "Pete's House …"). */
const shortTitle = (t: string) => {
  const last = t.split(" · ").pop() ?? t;
  return last.length > 30 ? `${last.slice(0, 29).trim()}…` : last;
};

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
  const [jump, setJump] = useState<Jump | null>(null);
  const pinCb = useRef<((ll: LatLng) => void) | null>(null);
  const autoPicked = useRef(false);
  const arrivedAt = useRef<string | null>(null);
  const mapAnchor = useRef<HTMLDivElement>(null);

  const toast = useCallback<Toast>((msg) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 3600);
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
      let cached: SnowRoute[] | null = null;
      try {
        const raw = readStore(LIST_KEY);
        cached = raw ? (JSON.parse(raw) as SnowRoute[]).map((r) => ({ ...r, stops: Array.isArray(r.stops) ? r.stops : [] })) : null;
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
  const atStop = useMemo(() => (here && here.acc <= 120 ? stopHere(sorted, here, selId) : null), [sorted, here, selId]);

  const pick = useCallback((id: string | null) => {
    setSelId(id);
    writeStore(ROUTE_KEY, id);
  }, []);
  const goTo = useCallback(
    (routeId: string, page: number | null) => {
      pick(routeId);
      if (page !== null) setJump({ page, n: Date.now() });
    },
    [pick],
  );

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

  // pulling up to a pinned stop opens its route at its page (once per arrival)
  useEffect(() => {
    const key = atStop ? `${atStop.route.id}:${atStop.stop.page}` : null;
    if (key === arrivedAt.current) return;
    arrivedAt.current = key;
    if (atStop) {
      autoPicked.current = true;
      goTo(atStop.route.id, atStop.stop.page);
    }
  }, [atStop, goTo]);

  const requestPin = useCallback((label: string, cb: (ll: LatLng) => void) => {
    pinCb.current = cb;
    setPlacing(label);
    mapAnchor.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  const cancelPin = useCallback(() => {
    pinCb.current = null;
    setPlacing(null);
  }, []);
  const onMapTap = useCallback((ll: LatLng) => {
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
  const stopDist = (st: SnowStop) => (here && st.lat !== null && st.lng !== null ? metersBetween(here.lat, here.lng, st.lat, st.lng) : null);

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
          No snow routes yet. {owner ? "Add the first one under Manage routes below." : "Isaac hasn't uploaded them. Check back soon."}
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

            {atStop ? (
              <div className={`${s.closest} ${s.atStop}`} data-testid="snow-at-stop">
                <p>
                  You&apos;re at <b>{atStop.stop.title}</b>
                  {atStop.route.id !== selected?.id ? ` (${atStop.route.name})` : ""} · page {atStop.stop.page}
                </p>
                <button type="button" className={g.btn} onClick={() => goTo(atStop.route.id, atStop.stop.page)}>
                  Show it
                </button>
              </div>
            ) : (
              closest &&
              closest.route.id !== selected?.id && (
                <div className={s.closest} data-testid="snow-closest">
                  <p>
                    Closest to you: <b>{closest.route.name}</b> ({fmtDistance(closest.meters)})
                  </p>
                  <button type="button" className={g.btn} onClick={() => pick(closest.route.id)}>
                    Open it
                  </button>
                </div>
              )
            )}
            {gps === "denied" && (
              <p className={g.note} style={{ textAlign: "left" }}>
                Location is blocked for this site, so the map can&apos;t show where you are. Pick your route from the list, or turn location on in
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
          atKey={atStop ? `${atStop.route.id}:${atStop.stop.page}` : null}
          here={here}
          placing={placing}
          onPoint={goTo}
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

          {selected.stops.length > 1 && (
            <details className={s.stops} data-testid="snow-stops">
              <summary>
                All stops ({selected.stops.length}) <span className={s.stopsHint}>tap one to go to its page</span>
              </summary>
              <ol>
                {selected.stops.map((st) => {
                  const d = stopDist(st);
                  const isHere = atStop?.route.id === selected.id && atStop.stop.page === st.page;
                  return (
                    <li key={st.page}>
                      <button type="button" className={`${s.stopBtn} ${isHere ? s.stopHere : ""}`} onClick={() => setJump({ page: st.page, n: Date.now() })} data-testid="snow-stop">
                        <span className={s.stopPage}>p.{st.page}</span>
                        <span className={s.stopTitle}>{st.title}</span>
                        <span className={s.stopDist}>{isHere ? "You're here" : d !== null ? fmtDistance(d) : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </details>
          )}

          <RouteViewer
            key={selected.id}
            route={selected}
            active={active}
            isSaved={saved.has(selected.id)}
            onSaved={() => void cacheIds().then(setSaved)}
            jump={jump}
          />
        </div>
      )}

      {sorted.length > 1 && (
        <div className={s.section}>
          <button type="button" className={`${g.btn} ${g.sec} ${g.block}`} disabled={!!savingAll || unsaved === 0} onClick={() => void saveAll()} data-testid="snow-save-all">
            {savingAll ?? (unsaved === 0 ? "All routes are saved on this phone" : `Save all ${sorted.length} routes for weak-signal use`)}
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
// Live map: the phone's position (blue dot + accuracy ring) and a red label for each pinned stop / route.

function LiveMap({
  active,
  routes,
  selectedId,
  atKey,
  here,
  placing,
  onPoint,
  onTap,
  onCancelPlacing,
}: {
  active: boolean;
  routes: SnowRoute[];
  selectedId: string | null;
  atKey: string | null;
  here: Here | null;
  placing: string | null;
  onPoint: (routeId: string, page: number | null) => void;
  onTap: (ll: LatLng) => void;
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
  const pointRef = useRef(onPoint);
  pointRef.current = onPoint;

  useEffect(() => {
    if (!active || mapRef.current) return;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !box.current || mapRef.current) return;
        const map = L.map(box.current, { minZoom: 3 }).setView(BOZEMAN, 13);
        L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
        pinsRef.current = L.layerGroup().addTo(map);
        map.on("click", (e: { latlng: LatLng }) => tapRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
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

  // labels: every pinned stop (or the route's own pin); the open route's in red, the stop you're at bigger
  useEffect(() => {
    const L = LRef.current;
    const layer = pinsRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    const all: [number, number][] = [];
    for (const r of routes) {
      const on = r.id === selectedId;
      for (const p of routePoints(r)) {
        const label = p.stop ? shortTitle(p.stop.title) : r.name;
        const at = p.stop !== null && atKey === `${r.id}:${p.stop.page}`;
        const span = document.createElement("span");
        span.textContent = label;
        const icon = L.divIcon({ className: `snow-pin${on ? " on" : ""}${at ? " at" : ""}`, html: span.outerHTML, iconSize: [0, 0] });
        L.marker([p.lat, p.lng], { icon, zIndexOffset: at ? 2000 : on ? 1000 : 0, keyboard: true, title: p.stop ? `${p.stop.title} (${r.name})` : r.name })
          .on("click", () => pointRef.current(r.id, p.stop ? p.stop.page : null))
          .addTo(layer);
        all.push([p.lat, p.lng]);
      }
    }
    if (!centered.current && all.length > 0 && !here) mapRef.current.fitBounds(all, { padding: [40, 40], maxZoom: 15 });
  }, [ready, routes, selectedId, atKey, here]);

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
      <div ref={box} className={s.snowMap} data-testid="snow-map" role="application" aria-label="Map of where you are and the snow route stops. Tap a label to open it." />
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
