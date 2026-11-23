"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../invoice/invoice.module.css";
import t from "./trends.module.css";
import { ALL_TYPES, CITIES, CITY_NAMES, City, TYPE_NAMES, autoCity, fmtPlainDate } from "@/lib/graffiti";
import type { Bucket, HotBlock, Trends } from "@/lib/graffitiTrends";
import { LeafletNS, TILE_ATTRIBUTION, TILE_URL, apiJson, loadLeaflet } from "../clientUtil";

// Owner, or a Manager (graffiti tab + invoice switch). How many tags we are finding, where, what kind, and what keeps
// coming back. Counts are when a crew FOUND and logged a tag, not when the graffiti went up (see "How to read this").

type Resp = { generated: string; tz: string; trends: Trends };
type RangeKey = "7" | "30" | "90" | "365" | "all" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "365", label: "Last year" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Pick dates" },
];

const TYPE_COLORS: Record<string, string> = {
  slap: "#1f6feb",
  chalk: "#d98a00",
  flyer: "#8e44ad",
  spray: "#d93025",
  sharpie: "#00897b",
  ssr: "#8d6e63",
  powerwash: "#9aa3af",
  other: "#7a828e",
};
const colorOf = (k: string) => TYPE_COLORS[k] ?? "#7a828e";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const hours = (min: number) => (min / 60).toFixed(1);
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const shortDay = (ymd: string) => fmtPlainDate(ymd).replace(/, \d{4}$/, "");

function Bars({ items, color, max = 8, testid }: { items: Bucket[]; color: (k: string) => string; max?: number; testid: string }) {
  const shown = items.slice(0, max);
  if (shown.length === 0) return <p className={t.empty}>Nothing to show.</p>;
  return (
    <ul className={t.hb} data-testid={testid}>
      {shown.map((b) => (
        <li key={b.key}>
          <span className={t.lab} title={b.label}>
            {b.label}
          </span>
          <span className={t.track}>
            <span className={t.fill} style={{ width: `${Math.min(100, b.pct)}%`, background: color(b.key) }} />
          </span>
          <span className={t.val}>
            <b>{b.n}</b> · {b.pct}%
          </span>
        </li>
      ))}
      {items.length > max && <li className={t.note}>+ {items.length - max} more</li>}
    </ul>
  );
}

function TimeChart({ series }: { series: Trends["series"] }) {
  const pts = series.points;
  const W = 1000;
  const H = 230;
  const L = 34;
  const B = 26;
  const T = 14;
  const max = Math.max(1, ...pts.map((p) => p.n));
  const niceMax = max <= 5 ? max : Math.ceil(max / 5) * 5;
  const slot = (W - L - 6) / Math.max(1, pts.length);
  const bw = Math.max(2, slot * 0.72);
  const every = Math.max(1, Math.ceil(pts.length / 12));
  const yOf = (n: number) => T + (H - T - B) * (1 - n / niceMax);
  const unitWord = series.unit === "day" ? "day" : series.unit === "week" ? "week starting" : "month";
  return (
    <svg className={t.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tags found per ${series.unit}`} data-testid="trend-chart">
      {[0, 0.5, 1].map((f) => {
        const v = Math.round(niceMax * f);
        return (
          <g key={f}>
            <line x1={L} x2={W - 4} y1={yOf(v)} y2={yOf(v)} stroke="#e3e7ec" />
            <text x={L - 6} y={yOf(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        );
      })}
      {pts.map((p, i) => {
        const x = L + i * slot + (slot - bw) / 2;
        const y = yOf(p.n);
        return (
          <g key={p.key}>
            <rect className={t.bar} x={x} y={y} width={bw} height={Math.max(0, yOf(0) - y)} rx={2}>
              <title>{`${unitWord} ${p.label}: ${plural(p.n, "tag")}`}</title>
            </rect>
            {pts.length <= 24 && p.n > 0 && (
              <text x={x + bw / 2} y={y - 3} textAnchor="middle">
                {p.n}
              </text>
            )}
            {i % every === 0 && (
              <text x={x + bw / 2} y={H - 8} textAnchor="middle">
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function TrendsPage() {
  const [range, setRange] = useState<RangeKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(todayLocal());
  const [city, setCity] = useState<City | "all">("all");
  const [type, setType] = useState("all");
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [mapCity, setMapCity] = useState<City | null>(null);
  const [mapMode, setMapMode] = useState<"tags" | "blocks">("tags");
  const box = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<{ L: LeafletNS; map: LeafletNS; layer: LeafletNS } | null>(null);
  const fitted = useRef("");
  const pendingZoom = useRef<HotBlock | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    document.title = "Trends · Isaac Borland";
  }, []);

  const query = useCallback(() => {
    const q = new URLSearchParams({ city, type });
    if (range === "custom") {
      if (from) q.set("from", from);
      if (to) q.set("to", to);
    } else if (range !== "all") q.set("last", range);
    return q.toString();
  }, [range, from, to, city, type]);

  useEffect(() => {
    const mine = ++seq.current;
    setBusy(true);
    apiJson<Resp>(`/api/graffiti/trends?${query()}`)
      .then((d) => {
        if (mine !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => mine === seq.current && setError(errMsg(e)))
      .finally(() => mine === seq.current && setBusy(false));
  }, [query]);

  const tr = data?.trends ?? null;

  // which city the map shows: the filter's city, else whichever has more tags (the two are ~160 km apart)
  const shownCity: City | null = tr ? (city !== "all" ? city : mapCity && tr.byCity.some((b) => b.key === mapCity) ? mapCity : ((tr.byCity[0]?.key as City | undefined) ?? null)) : null;

  useEffect(() => {
    if (!tr || !box.current || !shownCity) return;
    let alive = true;
    void loadLeaflet()
      .then((L) => {
        if (!alive || !box.current) return;
        // the map's container is replaced when there is a stretch with nothing to show: start a fresh map then
        if (mapRef.current && mapRef.current.map.getContainer() !== box.current) {
          mapRef.current.map.remove();
          mapRef.current = null;
        }
        if (!mapRef.current) {
          const map = L.map(box.current).setView([45.677, -111.0386], 13);
          L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
          mapRef.current = { L, map, layer: L.layerGroup().addTo(map) };
        }
        const { map, layer } = mapRef.current;
        layer.clearLayers();
        const pts = tr.points.filter((p) => p.c === shownCity);
        const blocks = tr.blocks.filter((b) => autoCity(b.lat, b.lng) === shownCity);
        if (mapMode === "tags") {
          for (const p of pts) {
            L.circleMarker([p.lat, p.lng], { radius: 6, weight: 1.5, color: "#fff", fillColor: colorOf(p.t), fillOpacity: 0.9 })
              .bindTooltip(`${p.a ? `<b>${esc(p.a)}</b><br/>` : ""}${esc(TYPE_NAMES[p.t as keyof typeof TYPE_NAMES] ?? p.t)} · ${esc(p.d)}`, { sticky: true })
              .addTo(layer);
          }
        } else {
          const top = Math.max(1, ...blocks.map((b) => b.n));
          for (const b of blocks) {
            L.rectangle(b.bounds, { weight: 1, color: "#b3261e", fillColor: "#d93025", fillOpacity: 0.15 + 0.5 * (b.n / top) })
              .bindTooltip(`<b>${esc(b.label)}</b><br/>${b.n} tag${b.n === 1 ? "" : "s"} · mostly ${esc(b.topType.toLowerCase())}`, { sticky: true })
              .addTo(layer);
          }
        }
        const key = `${shownCity}|${city}|${type}|${tr.range.from}|${tr.range.to}`;
        if (pendingZoom.current) {
          const b = pendingZoom.current;
          pendingZoom.current = null;
          map.fitBounds(b.bounds, { maxZoom: 17 });
        } else if (fitted.current !== key && pts.length) {
          fitted.current = key;
          map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [24, 24], maxZoom: 16 });
        }
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [tr, shownCity, mapMode, city, type]);

  const zoomTo = (b: HotBlock) => {
    pendingZoom.current = b;
    const c = autoCity(b.lat, b.lng);
    if (c !== shownCity) setMapCity(c);
    else if (mapRef.current) {
      mapRef.current.map.fitBounds(b.bounds, { maxZoom: 17 });
      pendingZoom.current = null;
    }
    box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const prevWord = tr ? `the ${tr.range.days} days before` : "";

  return (
    <div className={styles.page}>
      <div className={t.wrap}>
        <div style={{ marginBottom: 10 }}>
          <a className={`${styles.btn} ${styles.sec}`} href="/?tab=graffiti" data-testid="back-link">
            ← Back to tracker
          </a>
        </div>
        <h1 className={t.h1}>Trends: how many tags we&apos;re finding, and where</h1>
        <p className={t.lead}>
          Counts are tags our crews <b>found and logged</b>. More patrolling finds more tags, so read this as &quot;where the work is&quot;, not a perfect measure of how much graffiti goes up.
        </p>

        <div className={`${styles.panel} ${t.filters}`}>
          <div>
            <span className={t.fl2}>Time period</span>
            <div className={t.chips} role="group" aria-label="Time period">
              {RANGES.map((r) => (
                <button key={r.key} type="button" className={t.chip} aria-pressed={range === r.key} data-testid={`range-${r.key}`} onClick={() => setRange(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {range === "custom" && (
            <div className={t.row}>
              <div>
                <label className={t.fl2} htmlFor="tr-from">
                  From
                </label>
                <input id="tr-from" type="date" value={from} max={to || todayLocal()} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className={t.fl2} htmlFor="tr-to">
                  To
                </label>
                <input id="tr-to" type="date" value={to} min={from || undefined} max={todayLocal()} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          )}
          <div className={t.row}>
            <div>
              <span className={t.fl2}>City</span>
              <div className={t.chips} role="group" aria-label="City">
                {(["all", ...CITIES] as const).map((c) => (
                  <button key={c} type="button" className={t.chip} aria-pressed={city === c} data-testid={`city-${c}`} onClick={() => setCity(c)}>
                    {c === "all" ? "Both cities" : CITY_NAMES[c]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={t.fl2} htmlFor="tr-type">
                Tag type
              </label>
              <select id="tr-type" value={type} onChange={(e) => setType(e.target.value)} data-testid="type-select">
                <option value="all">All types</option>
                {ALL_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {TYPE_NAMES[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error && <div className={`${styles.panel} ${styles.bad}`}>{error}</div>}
        {!tr && !error && <div className={`${styles.panel} ${t.empty}`}>Loading…</div>}

        {tr && (
          <div style={{ opacity: busy ? 0.55 : 1, transition: "opacity .15s" }} data-testid="trends-body" aria-busy={busy}>
            <div className={styles.panel} data-testid="insights">
              <h2 className={t.h2}>What stands out</h2>
              <p className={t.note} style={{ marginTop: 0 }}>
                {shortDay(tr.range.from)} to {shortDay(tr.range.to)} · {plural(tr.range.days, "day")}
              </p>
              <ul className={t.insights}>
                {tr.insights.map((i, k) => (
                  <li key={k} data-level={i.level}>
                    {i.text}
                  </li>
                ))}
              </ul>
            </div>

            <div className={t.kpis} data-testid="kpis">
              <div className={t.kpi}>
                <b data-testid="kpi-tags">{tr.totals.tags.toLocaleString("en-US")}</b>
                <span>tags found</span>
                {tr.compare.available && tr.compare.deltaPct !== null && (
                  <i className={tr.compare.deltaPct > 0 ? t.up : t.down} title={`${tr.compare.prevTags} in ${prevWord}`}>
                    {tr.compare.deltaPct > 0 ? "▲" : tr.compare.deltaPct < 0 ? "▼" : "="} {Math.abs(tr.compare.deltaPct)}% vs {prevWord}
                  </i>
                )}
              </div>
              <div className={t.kpi}>
                <b>{tr.totals.perDay}</b>
                <span>tags a day, on average</span>
              </div>
              <div className={t.kpi}>
                <b>{tr.totals.open}</b>
                <span>still open{tr.lag.oldestOpenDays !== null ? ` (oldest ${tr.lag.oldestOpenDays}d)` : ""}</span>
              </div>
              <div className={t.kpi}>
                <b>{hours(tr.totals.minutes)} h</b>
                <span>logged labor{tr.totals.avgMin !== null ? ` · avg ${tr.totals.avgMin} min` : ""}</span>
              </div>
              {tr.repeat.pct !== null && (
                <div className={t.kpi}>
                  <b>{tr.repeat.pct}%</b>
                  <span>came back to a cleaned spot</span>
                </div>
              )}
            </div>

            <div className={styles.panel}>
              <h2 className={t.h2}>Tags found per {tr.series.unit}</h2>
              <TimeChart series={tr.series} />
              {tr.series.unit === "week" && <p className={t.note}>Each bar is a week, starting on the Monday shown.</p>}
            </div>

            <div className={t.grid2}>
              <div className={styles.panel}>
                <h2 className={t.h2}>What kind</h2>
                <Bars items={tr.byType} color={colorOf} testid="by-type" />
                {tr.byType.some((b) => b.minutes > 0) && (
                  <p className={t.note}>
                    Average logged time:{" "}
                    {tr.byType
                      .filter((b) => b.avgMin !== null)
                      .slice(0, 5)
                      .map((b) => `${b.label} ${b.avgMin} min`)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <div className={styles.panel}>
                <h2 className={t.h2}>What it&apos;s on</h2>
                <Bars items={tr.bySurface} color={() => "#5b8def"} max={9} testid="by-surface" />
              </div>
            </div>

            <div className={t.grid2}>
              <div className={styles.panel}>
                <h2 className={t.h2}>Top streets</h2>
                <ul className={t.hb} data-testid="streets">
                  {tr.streets.length === 0 && <li className={t.empty}>No addresses recorded.</li>}
                  {tr.streets.slice(0, 8).map((s) => (
                    <li key={s.key}>
                      <span className={t.lab} title={`${s.label} (${CITY_NAMES[s.city]})`}>
                        {s.label}
                        {tr.byCity.length > 1 ? ` · ${CITY_NAMES[s.city]}` : ""}
                      </span>
                      <span className={t.track}>
                        <span className={t.fill} style={{ width: `${Math.min(100, s.pct)}%`, background: "#c0392b" }} />
                      </span>
                      <span className={t.val}>
                        <b>{s.n}</b> · {s.pct}%
                      </span>
                    </li>
                  ))}
                </ul>
                <p className={t.note}>East and West of the same street are counted together.</p>
              </div>
              <div className={styles.panel}>
                <h2 className={t.h2}>Busiest blocks</h2>
                <ul className={t.list} data-testid="blocks">
                  {tr.blocks.length === 0 && <li className={t.empty}>Nothing yet.</li>}
                  {tr.blocks.slice(0, 8).map((b) => (
                    <li key={b.key}>
                      <button type="button" className={styles.linkish} style={{ textAlign: "left" }} onClick={() => zoomTo(b)}>
                        {b.label}
                        {tr.byCity.length > 1 ? ` · ${CITY_NAMES[autoCity(b.lat, b.lng)]}` : ""}
                      </button>
                      <span className={t.sub2}>
                        <b>{b.n}</b> tags · mostly {b.topType.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className={t.note}>A block here is a patch of roughly 300 m (3 or 4 city blocks). Tap one to find it on the map.</p>
              </div>
            </div>

            <div className={styles.panel}>
              <div className={t.row} style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <h2 className={t.h2} style={{ margin: 0 }}>
                  Map
                </h2>
                <div className={t.row}>
                  {tr.byCity.length > 1 && city === "all" && (
                    <div className={t.chips} role="group" aria-label="Map city">
                      {tr.byCity.map((b) => (
                        <button key={b.key} type="button" className={t.chip} aria-pressed={shownCity === b.key} onClick={() => setMapCity(b.key as City)}>
                          {b.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={t.chips} role="group" aria-label="Map view">
                    <button type="button" className={t.chip} aria-pressed={mapMode === "tags"} data-testid="map-tags" onClick={() => setMapMode("tags")}>
                      Every tag
                    </button>
                    <button type="button" className={t.chip} aria-pressed={mapMode === "blocks"} data-testid="map-blocks" onClick={() => setMapMode("blocks")}>
                      Hot blocks
                    </button>
                  </div>
                </div>
              </div>
              {tr.points.length === 0 ? (
                <p className={t.empty}>No tags to put on the map for these filters.</p>
              ) : (
                <>
                  <div ref={box} className={t.map} data-testid="trend-map" />
                  <div className={t.legend}>
                    {mapMode === "tags" ? (
                      tr.byType.map((b) => (
                        <span key={b.key}>
                          <i className={t.dot} style={{ background: colorOf(b.key) }} />
                          {b.label}
                        </span>
                      ))
                    ) : (
                      <span>Darker red = more tags in that ~300 m patch (top 10 shown).</span>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className={t.grid2}>
              <div className={styles.panel} data-testid="repeat-panel">
                <h2 className={t.h2}>Keeps coming back</h2>
                {tr.repeat.sites.length === 0 ? (
                  <p className={t.empty}>No spot has been re-tagged after we cleaned it.</p>
                ) : (
                  <ul className={t.list}>
                    {tr.repeat.sites.map((s) => (
                      <li key={`${s.lat},${s.lng}`}>
                        <span>{s.label}</span>
                        <span className={t.sub2}>
                          found on <b>{s.days}</b> different days · {s.typeLabel.toLowerCase()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className={t.note}>
                  &quot;Same spot&quot; means within about 25 m of an earlier tag, and it only counts as coming back if it was found a day or more after the earlier one was removed. GPS can wander a few meters, so treat the exact
                  spots as a guide.
                </p>
              </div>
              <div className={styles.panel} data-testid="backlog-panel">
                <h2 className={t.h2}>Found vs. cleaned</h2>
                {tr.lag.open === 0 && tr.lag.later === 0 ? (
                  <p className={t.empty}>Everything was removed the day it was found.</p>
                ) : (
                  <>
                    {tr.lag.openList.length > 0 && (
                      <ul className={t.list}>
                        {tr.lag.openList.map((o) => (
                          <li key={o.id}>
                            <span>{o.label}</span>
                            <span className={t.sub2}>
                              open {o.days === 0 ? "since today" : `${plural(o.days, "day")}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {tr.lag.later > 0 && (
                      <p className={t.note}>
                        {plural(tr.lag.later, "tag")} waited more than a day before removal{tr.lag.medianDays !== null ? ` (typically ${tr.lag.medianDays} days)` : ""}.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className={styles.panel}>
              <details className={t.details}>
                <summary>Who handled them</summary>
                <ul className={t.list} style={{ marginTop: 8 }} data-testid="crew">
                  {tr.crew.map((c) => (
                    <li key={c.name}>
                      <span>{c.name}</span>
                      <span className={t.sub2}>
                        <b>{c.n}</b> tags{c.avgMin !== null ? ` · avg ${c.avgMin} min` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className={t.note}>This is workload (who finished or took each tag), not a performance score. Time is whatever was logged, and most tags are logged at 1 or 2 minutes.</p>
              </details>
            </div>

            <div className={`${styles.panel} ${styles.warn}`}>
              <b>How to read this</b>
              <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 13.5 }}>
                <li>The date is when a crew found and logged the tag. It is not when the graffiti went up, so a busy day often means a sweep, not a spike in vandalism.</li>
                <li>More time spent driving an area finds more tags there, so a busy street can partly mean it gets checked the most.</li>
                <li>Trends need time. A few weeks of data can show where tags are, but not seasons or long-term change.</li>
                <li>Surface names are typed by hand, so similar ones (bus stop, bus shelter) are combined here. Anything unusual is listed as typed.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
