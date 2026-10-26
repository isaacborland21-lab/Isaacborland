"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../invoice/invoice.module.css";
import { CITIES, CITY_NAMES, City, isCity } from "@/lib/graffiti";
import { CoverageCell, NEVER_COLOR, STALE_COLORS, STALE_LABELS, cellBounds, cellCenter, daysSince, staleBucket } from "@/lib/patrol";
import { LeafletNS, TILE_ATTRIBUTION, TILE_URL, apiJson, loadLeaflet } from "../clientUtil";

// Owner only: where crews have (and haven't) been. Each ~300 m block is colored by days since a crew last drove through it
// while patrolling or logged a tag there. Grey = never covered. "Check next" lists busy blocks nobody has covered lately.

type Coverage = { city: City; now: string; cells: CoverageCell[]; top: (CoverageCell & { days: number | null; score: number })[] };
type Routes = { day: string; crews: { name: string; color: string; lines: [number, number][][]; last: string; live: boolean }[] };

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const daysText = (d: number | null) => (d === null ? "never covered" : d === 0 ? "covered today" : d === 1 ? "covered yesterday" : `covered ${d} days ago`);
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function CoveragePage() {
  const [city, setCity] = useState<City>("bozeman");
  const [data, setData] = useState<Coverage | null>(null);
  const [routes, setRoutes] = useState<Routes | null>(null);
  const [day, setDay] = useState(todayLocal());
  const [showRoutes, setShowRoutes] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ L: LeafletNS; map: LeafletNS; grid: LeafletNS; lines: LeafletNS } | null>(null);
  const fittedCity = useRef<string>("");

  useEffect(() => {
    document.title = "Coverage · Isaac Borland";
    const c = new URLSearchParams(window.location.search).get("city");
    if (isCity(c)) setCity(c);
  }, []);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        apiJson<Coverage>(`/api/graffiti/coverage?city=${city}`),
        apiJson<Routes>(`/api/graffiti/patrol?day=${day}&city=${city}`),
      ]);
      setData(c);
      setRoutes(r);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [city, day]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!data || !box.current) return;
    let alive = true;
    void loadLeaflet()
      .then((L) => {
        if (!alive || !box.current) return;
        if (!mapRef.current) {
          const map = L.map(box.current).setView([45.677, -111.0386], 13);
          L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
          mapRef.current = { L, map, grid: L.layerGroup().addTo(map), lines: L.layerGroup().addTo(map) };
        }
        const { map, grid, lines } = mapRef.current;
        grid.clearLayers();
        lines.clearLayers();
        const now = Date.parse(data.now);
        for (const c of data.cells) {
          const d = daysSince(c.last, now);
          const b = staleBucket(d);
          const color = b === null ? NEVER_COLOR : STALE_COLORS[b];
          L.rectangle(cellBounds(c.key), { stroke: true, weight: c.tags > 0 ? 1.5 : 0.4, color: c.tags > 0 ? "#111" : color, fillColor: color, fillOpacity: b === null ? 0.18 : 0.42 })
            .bindTooltip(
              `${c.place ? `<b>${esc(c.place)}</b><br/>` : ""}${esc(daysText(d))}${c.lastBy ? ` by ${esc(c.lastBy)}` : ""}<br/>${c.tags} tag${c.tags === 1 ? "" : "s"} in the last year`,
              { sticky: true },
            )
            .addTo(grid);
        }
        if (showRoutes && routes) {
          for (const cr of routes.crews) for (const line of cr.lines) L.polyline(line, { color: cr.color, weight: 4, opacity: 0.8 }).addTo(lines);
        }
        if (fittedCity.current !== data.city) {
          fittedCity.current = data.city;
          const all = data.cells.map((c) => cellCenter(c.key));
          if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [10, 10] });
        }
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [data, routes, showRoutes]);

  const zoomTo = (key: string) => {
    const m = mapRef.current;
    if (!m) return;
    m.map.fitBounds(m.L.latLngBounds(cellBounds(key)), { maxZoom: 17 });
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const now = data ? Date.parse(data.now) : Date.now();
  const counts = data
    ? data.cells.reduce(
        (a, c) => {
          const b = staleBucket(daysSince(c.last, now));
          if (b === null) a.never += 1;
          else if (b <= 2) a.week += 1;
          else a.stale += 1;
          return a;
        },
        { week: 0, stale: 0, never: 0 },
      )
    : null;

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <div className={styles.panel}>
          <div style={{ marginBottom: 10 }}>
            <a className={`${styles.btn} ${styles.sec}`} href="/?tab=graffiti" data-testid="back-link">
              ← Back to tracker
            </a>
          </div>
          <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Coverage: where crews have and haven&apos;t been</h2>
          <div className={styles.ctl} role="group" aria-label="City">
            {CITIES.map((k) => (
              <button key={k} type="button" className={`${styles.btn} ${city === k ? "" : styles.sec}`} aria-pressed={city === k} data-testid={`cov-city-${k}`} onClick={() => setCity(k)}>
                {CITY_NAMES[k]}
              </button>
            ))}
          </div>
          <div className={styles.ctl} style={{ marginTop: 10 }}>
            <div>
              <label htmlFor="cov-day">Routes driven on</label>
              <input id="cov-day" type="date" value={day} max={todayLocal()} onChange={(e) => e.target.value && setDay(e.target.value)} />
            </div>
            <div>
              <label>&nbsp;</label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
                <input type="checkbox" checked={showRoutes} onChange={(e) => setShowRoutes(e.target.checked)} /> Show routes
              </label>
            </div>
          </div>
          {routes && showRoutes && (
            <p className={styles.sub} data-testid="cov-routes">
              {routes.crews.length === 0
                ? "No patrol routes recorded that day."
                : routes.crews.map((c) => (
                    <span key={c.name} style={{ marginRight: 12, display: "inline-block" }}>
                      <i style={{ display: "inline-block", width: 14, height: 4, background: c.color, verticalAlign: "middle", marginRight: 4 }} />
                      {c.name}
                      {c.live ? " (active now)" : ""}
                    </span>
                  ))}
            </p>
          )}
          <div className={styles.sub} style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 }} data-testid="cov-legend">
            {STALE_LABELS.map((l, i) => (
              <span key={l}>
                <i style={{ display: "inline-block", width: 12, height: 12, background: STALE_COLORS[i], opacity: 0.8, verticalAlign: "-2px", marginRight: 4 }} />
                {l}
              </span>
            ))}
            <span>
              <i style={{ display: "inline-block", width: 12, height: 12, background: NEVER_COLOR, opacity: 0.6, verticalAlign: "-2px", marginRight: 4 }} />
              Never covered
            </span>
            <span>Dark outline = had tags in the last year</span>
          </div>
          {counts && (
            <p className={styles.sub} data-testid="cov-counts">
              Blocks covered in the last week: <b>{counts.week}</b> · older: <b>{counts.stale}</b> · never: <b>{counts.never}</b>. Coverage counts a block when a crew
              drove through it with Patrolling on, or logged a tag there.
            </p>
          )}
        </div>
        {error && <div className={`${styles.panel} ${styles.bad}`}>{error}</div>}
        {data && data.top.length > 0 && (
          <div className={`${styles.panel} ${styles.warn}`} data-testid="cov-top">
            <b>Check next</b> (blocks that get tagged but haven&apos;t been covered lately):
            <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
              {data.top.map((c) => (
                <li key={c.key} style={{ margin: "4px 0" }}>
                  <button type="button" className={styles.linkish} onClick={() => zoomTo(c.key)}>
                    {c.place || "Unnamed block"}
                  </button>{" "}
                  <span className={styles.sub} style={{ display: "inline" }}>
                    · {c.tags} tag{c.tags === 1 ? "" : "s"} in the last year · {daysText(c.days)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div ref={box} style={{ height: "70vh", minHeight: 360, margin: "0 auto 24px", maxWidth: 1100, borderRadius: 12, overflow: "hidden" }} data-testid="cov-map" />
    </div>
  );
}
