"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import styles from "./map.module.css";
import { LeafletNS, TILE_ATTRIBUTION, TILE_URL, loadLeaflet } from "../../../graffiti/clientUtil";
import { MONTH_COLORS, PublicTag } from "@/lib/clientMap";

// The live client map: read-only, no sign-in, refreshes itself every minute.
// One toggle per season (like a layer), pins colored by month.

type MapData = { title: string; cityName: string; by: string; updated: string; seasons: { key: string; label: string; count: number }[]; tags: PublicTag[] };

const REFRESH_MS = 60_000;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
};

export default function ClientMapPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [on, setOn] = useState<Set<string> | null>(null); // seasons shown; null until the first load picks the newest
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ L: LeafletNS; map: LeafletNS; layer: LeafletNS } | null>(null);
  const fitted = useRef("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/share/map/${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not load the map.");
      setData(body as MapData);
      setError(null);
      setOn((cur) => cur ?? new Set((body as MapData).seasons.slice(0, 1).map((s) => s.key)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the map.");
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (data) document.title = data.title;
  }, [data]);

  const shown = useMemo(() => (data && on ? data.tags.filter((t) => on.has(t.season)) : []), [data, on]);
  const months = useMemo(() => {
    const m = new Map<string, { no: number; count: number }>();
    for (const t of shown) m.set(t.month, { no: t.monthNo, count: (m.get(t.month)?.count ?? 0) + 1 });
    return [...m.entries()].map(([label, v]) => ({ label, ...v }));
  }, [shown]);

  // draw the pins (and build the map the first time)
  useEffect(() => {
    if (!data || !mapEl.current) return;
    let alive = true;
    void loadLeaflet()
      .then((L) => {
        if (!alive || !mapEl.current) return;
        if (!mapRef.current) {
          const map = L.map(mapEl.current, { zoomControl: true }).setView([45.679, -111.038], 13);
          L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
          mapRef.current = { L, map, layer: L.layerGroup().addTo(map) };
        }
        const { map, layer } = mapRef.current;
        layer.clearLayers();
        for (const t of shown) {
          L.circleMarker([t.lat, t.lng], { radius: 8, weight: 2, color: "#fff", fillColor: MONTH_COLORS[t.monthNo - 1], fillOpacity: 0.95 })
            .bindPopup(
              `<div class="${styles.popup}"><b>${esc(t.address || "Graffiti removed")}</b>${esc(fmtDay(t.day))}<br/>${esc(t.type)}</div>`,
            )
            .addTo(layer);
        }
        // zoom to the pins when the choice of seasons changes (not on every refresh, so a client's zoom is kept)
        const sel = [...(on ?? [])].sort().join(",");
        if (shown.length > 0 && fitted.current !== sel) {
          fitted.current = sel;
          map.fitBounds(L.latLngBounds(shown.map((t) => [t.lat, t.lng])), { padding: [30, 30], maxZoom: 16 });
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "The map could not load."));
    return () => {
      alive = false;
    };
  }, [data, shown, on]);

  const toggle = (k: string) =>
    setOn((cur) => {
      const n = new Set(cur ?? []);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (error && !data) {
    return (
      <div className={styles.page}>
        <p className={styles.msg} data-testid="share-error">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="client-map">
      <div className={styles.head}>
        <h1 className={styles.title}>{data?.title ?? "Loading…"}</h1>
        {data && (
          <p className={styles.sub}>
            Finished graffiti removals in {data.cityName}
            {data.by ? ` by ${data.by}` : ""} · updates automatically · last checked{" "}
            {new Date(data.updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        )}
        {data && data.seasons.length > 0 && (
          <div className={styles.bar} role="group" aria-label="Seasons">
            {data.seasons.map((s) => (
              <button key={s.key} type="button" className={styles.chip} aria-pressed={on?.has(s.key) ?? false} data-testid={`season-${s.key}`} onClick={() => toggle(s.key)}>
                {s.label} ({s.count})
              </button>
            ))}
            {data.seasons.length > 1 && (
              <button type="button" className={styles.chip} data-testid="season-all" onClick={() => setOn(new Set(data.seasons.map((s) => s.key)))}>
                Show all
              </button>
            )}
          </div>
        )}
        {months.length > 0 && (
          <div className={styles.legend} data-testid="legend">
            {months.map((m) => (
              <span key={m.label}>
                <span className={styles.dot} style={{ background: MONTH_COLORS[m.no - 1] }} />
                {m.label} ({m.count})
              </span>
            ))}
          </div>
        )}
        {data && data.tags.length === 0 && <p className={styles.sub}>No finished removals yet.</p>}
      </div>
      <div ref={mapEl} className={styles.map} data-testid="client-map-canvas" />
    </div>
  );
}
