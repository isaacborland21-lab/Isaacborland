"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../../invoice/invoice.module.css";
import t from "../trends.module.css";
import m from "./import.module.css";
import { CITIES, CITY_NAMES, City, GRAFFITI_TYPES, TYPE_NAMES } from "@/lib/graffiti";
import { apiJson } from "../../clientUtil";
import { normAddr, ParsedRow } from "@/lib/graffitiImport";
import { OVERPASS_URL, Found, nominatimUrl, overpassQuery, pickNominatim, pickPosition, splitIntersection } from "@/lib/graffitiGeocode";

// Owner only. Bring in the tags from OLD invoices (the "Instance Reporting" sheet) so Trends can look further back.
// 1. choose the city and the files  2. look over what was read  3. (optional) find map positions  4. import.
// Nothing is saved until the last button, and every import can be undone as a whole.

type PRow = ParsedRow & { key: string; dupe: boolean; overlap: boolean; geo: "none" | "found"; inc: boolean };
type Preview = { city: City; rows: Omit<PRow, "inc">[]; skipped: { file: string; line: number; why: string }[]; notes: string[]; counts: { read: number; fresh: number; dupes: number; overlap: number } };
type Batch = { batch: string; file: string | null; city: string; n: number; placed: number; from: string; to: string; at: string };
type GeoState = "found" | "several" | "none" | "error";

const SHOW = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const osmLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
const shortDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const plural = (n: number, w: string) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;

export default function ImportPage() {
  const [city, setCity] = useState<City>("bozeman");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [rows, setRows] = useState<PRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [withOverlap, setWithOverlap] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoProg, setGeoProg] = useState<{ done: number; total: number } | null>(null);
  const [geoState, setGeoState] = useState<Record<string, GeoState>>({});
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const stop = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadBatches = useCallback(async () => {
    try {
      const d = await apiJson<{ batches: Batch[] }>("/api/graffiti/history", { cache: "no-store" });
      setBatches(d.batches);
    } catch {
      setBatches([]);
    }
  }, []);
  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const read = async () => {
    setError(null);
    setDone(null);
    if (files.length === 0) {
      setError("Choose at least one invoice file first.");
      return;
    }
    // the host rejects uploads over about 4.5 MB in total, with an error that does not say why
    if (files.reduce((a, f) => a + f.size, 0) > 4 * 1024 * 1024) {
      setError("Those files add up to more than 4 MB. Read them a few at a time (an invoice is usually well under 1 MB).");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("city", city);
      for (const f of files) fd.append("files", f);
      const p = await apiJson<Preview>("/api/graffiti/history/preview", { method: "POST", body: fd });
      setPrev(p);
      setGeoState({});
      setShowAll(false);
      setRows(p.rows.map((r) => ({ ...r, inc: !r.dupe && !r.overlap })));
    } catch (e) {
      setPrev(null);
      setRows([]);
      setError(e instanceof Error ? e.message : "Could not read the files.");
    } finally {
      setBusy(false);
    }
  };

  const patch = (i: number, p: Partial<PRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const setOverlap = (on: boolean) => {
    setWithOverlap(on);
    setRows((rs) => rs.map((r) => (r.overlap && !r.dupe ? { ...r, inc: on } : r)));
  };

  const chosen = rows.filter((r) => r.inc && !r.dupe);
  const needPos = chosen.filter((r) => r.lat === null && r.address.trim());

  const findPositions = async () => {
    stop.current = false;
    setGeoBusy(true);
    setError(null);
    // one lookup per distinct place, then every row with that place gets the answer
    const places = new Map<string, string>();
    for (const r of needPos) if (!places.has(normAddr(r.address))) places.set(normAddr(r.address), r.address);
    const list = [...places.entries()];
    setGeoProg({ done: 0, total: list.length });
    const found = new Map<string, { lat: number; lng: number }>();
    const state: Record<string, GeoState> = {};
    let i = 0;
    for (const [key, addr] of list) {
      if (stop.current) break;
      let pick: Found = { ok: false, why: "none" };
      let failed = false;
      const parts = splitIntersection(addr);
      let url: string | null = null;
      let isOver = false;
      if (parts.length >= 2) {
        const q = overpassQuery(city, parts[0], parts[1]);
        if (q) {
          url = `${OVERPASS_URL}?data=${encodeURIComponent(q)}`;
          isOver = true;
        }
      } else if (/^\d/.test(addr.trim())) {
        url = nominatimUrl(city, addr);
      }
      if (url) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(url, { headers: { Accept: "application/json" } });
            if (res.status === 429 || res.status >= 500) throw new Error(String(res.status));
            const j: unknown = await res.json();
            pick = isOver ? pickPosition(j) : pickNominatim(j, city);
            failed = false;
            break;
          } catch {
            failed = true;
            await sleep(6000);
          }
        }
      }
      if (pick.ok) {
        found.set(key, { lat: pick.lat, lng: pick.lng });
        state[key] = "found";
      } else state[key] = failed ? "error" : pick.why;
      i += 1;
      setGeoProg({ done: i, total: list.length });
      setGeoState((s) => ({ ...s, [key]: state[key] }));
      if (found.has(key)) {
        const at = found.get(key)!;
        setRows((rs) => rs.map((r) => (r.lat === null && normAddr(r.address) === key ? { ...r, lat: at.lat, lng: at.lng, geo: "found" } : r)));
      }
      await sleep(1200); // the free map services ask for no more than about one question a second
    }
    setGeoBusy(false);
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = chosen.map((r) => ({ day: r.day, address: r.address, gtype: r.gtype, gtype_other: r.gtype_other, surface: r.surface, chemical: r.chemical, notes: r.notes, duration_min: r.duration_min, arrive_min: r.arrive_min, lat: r.lat, lng: r.lng }));
      const out = await apiJson<{ inserted: number; already: number; rejected: number }>("/api/graffiti/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city, source: files.map((f) => f.name).join(", "), rows: body }),
      });
      setDone(`Imported ${plural(out.inserted, "tag")}${out.already ? ` (${out.already} were already imported)` : ""}${out.rejected ? `, ${out.rejected} could not be used` : ""}.`);
      setPrev(null);
      setRows([]);
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      loadBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the import.");
    } finally {
      setBusy(false);
    }
  };

  const undo = async (b: Batch) => {
    if (!window.confirm(`Remove all ${b.n} tags from this import (${b.file ?? "unnamed"})? Your live tracker is not touched.`)) return;
    setError(null);
    try {
      await apiJson(`/api/graffiti/history?batch=${encodeURIComponent(b.batch)}`, { method: "DELETE" });
      setDone(`Removed ${plural(b.n, "tag")} from Trends.`);
      loadBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo that import.");
    }
  };

  const visible = showAll ? rows : rows.slice(0, SHOW);
  const geoCounts = Object.values(geoState).reduce<Record<string, number>>((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {});

  return (
    <div className={styles.page}>
      <div className={t.wrap}>
        <div style={{ marginBottom: 10 }}>
          <a className={`${styles.btn} ${styles.sec}`} href="/graffiti/trends" data-testid="back-trends">
            ← Back to Trends
          </a>
        </div>
        <h1 className={t.h1}>Import old invoices</h1>
        <p className={t.lead}>
          Bring in tags from invoices made before the tracker, so Trends can look further back. Use your invoice spreadsheet (<b>.xlsx</b>) with its <b>Instance Reporting</b> sheet, or a <b>.csv</b> with Date and Street Intersection columns. These tags only feed the Trends page: they never change your live tracker, invoices, patrol or coverage.
        </p>

        {error && (
          <div className={`${styles.panel} ${styles.bad}`} data-testid="import-error">
            {error}
          </div>
        )}
        {done && (
          <div className={`${styles.panel} ${styles.ok}`} data-testid="import-done">
            {done} <a href="/graffiti/trends">See Trends →</a>
          </div>
        )}

        <div className={styles.panel}>
          <b>1. Choose the files</b>
          <div className={styles.ctl} style={{ marginTop: 8 }}>
            <div>
              <label htmlFor="imp-city">City these invoices were for</label>
              <select id="imp-city" value={city} onChange={(e) => setCity(e.target.value as City)} data-testid="imp-city">
                {CITIES.map((c) => (
                  <option key={c} value={c}>
                    {CITY_NAMES[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="imp-files">Invoice files (one or many)</label>
              <input ref={fileInput} id="imp-files" type="file" multiple accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} data-testid="imp-files" />
            </div>
            <button type="button" className={styles.btn} onClick={read} disabled={busy || files.length === 0} data-testid="imp-read">
              {busy && !prev ? "Reading…" : "Read the files"}
            </button>
          </div>
          <p className={m.small} style={{ margin: "8px 0 0" }}>
            Only the invoice&apos;s tag list can be read. A PDF, or an invoice with only the money lines (no date for each tag), can&apos;t be imported. Nothing is saved until step 4.
          </p>
        </div>

        {prev && (
          <>
            {(prev.notes.length > 0 || prev.skipped.length > 0) && (
              <div className={`${styles.panel} ${styles.warn}`} data-testid="imp-notes">
                <ul className={m.list} style={{ marginTop: 0 }}>
                  {prev.notes.map((n, k) => (
                    <li key={k}>{n}</li>
                  ))}
                </ul>
                {prev.skipped.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary>
                      {plural(prev.skipped.length, "row")} skipped
                    </summary>
                    <ul className={m.list}>
                      {prev.skipped.slice(0, 50).map((s, k) => (
                        <li key={k}>
                          {s.file}, row {s.line}: {s.why}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {rows.length > 0 && (
              <div className={styles.panel} data-testid="imp-preview">
                <b>2. Look it over</b>
                <div className={m.sum} data-testid="imp-sum">
                  <span>
                    <b>{prev.counts.read}</b> tags read
                  </span>
                  <span>
                    <b>{prev.counts.fresh}</b> new
                  </span>
                  <span>
                    <b>{prev.counts.dupes}</b> already imported
                  </span>
                  <span>
                    <b>{prev.counts.overlap}</b> on days the tracker already has
                  </span>
                </div>
                {prev.counts.overlap > 0 && (
                  <label style={{ display: "block", fontSize: 13.5, marginBottom: 6 }}>
                    <input type="checkbox" checked={withOverlap} onChange={(e) => setOverlap(e.target.checked)} data-testid="imp-overlap" /> Include the {plural(prev.counts.overlap, "tag")} on days the live tracker already has {CITY_NAMES[prev.city]} tags for (they may be counted twice)
                  </label>
                )}
                <div className={m.tw}>
                  <table className={m.tbl}>
                    <thead>
                      <tr>
                        <th />
                        <th>Date</th>
                        <th>Place</th>
                        <th>Type</th>
                        <th>Surface</th>
                        <th>Chemical</th>
                        <th>Min</th>
                        <th>Map</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody data-testid="imp-rows">
                      {visible.map((r, i) => {
                        const gs = geoState[normAddr(r.address)];
                        return (
                          <tr key={`${r.file}:${r.line}:${i}`} className={r.inc ? "" : m.off}>
                            <td>
                              <input type="checkbox" checked={r.inc} disabled={r.dupe} onChange={(e) => patch(i, { inc: e.target.checked })} aria-label={`Import row ${r.line}`} />
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>{shortDate(r.day)}</td>
                            <td>
                              <input type="text" value={r.address} maxLength={200} onChange={(e) => patch(i, { address: e.target.value, lat: null, lng: null, geo: "none" })} aria-label={`Place for row ${r.line}`} />
                            </td>
                            <td>
                              <select
                                value={r.gtype}
                                onChange={(e) => patch(i, { gtype: e.target.value, gtype_other: e.target.value === "other" ? r.gtype_other : null })}
                                aria-label={`Type for row ${r.line}`}
                              >
                                {(GRAFFITI_TYPES as readonly string[]).includes(r.gtype) ? null : <option value={r.gtype}>{r.gtype}</option>}
                                {GRAFFITI_TYPES.map((g) => (
                                  <option key={g} value={g}>
                                    {TYPE_NAMES[g]}
                                  </option>
                                ))}
                              </select>
                              {r.gtype === "other" && r.gtype_other ? <div className={m.small}>{r.gtype_other}</div> : null}
                            </td>
                            <td>{r.surface ?? "—"}</td>
                            <td>{r.chemical ?? "—"}</td>
                            <td>{r.duration_min ?? "—"}</td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {r.lat !== null && r.lng !== null ? (
                                <a href={osmLink(r.lat, r.lng)} target="_blank" rel="noreferrer">
                                  found ↗
                                </a>
                              ) : gs === "several" ? (
                                <span className={m.small}>several matches</span>
                              ) : gs === "none" || gs === "error" ? (
                                <span className={m.small}>{gs === "error" ? "lookup failed" : "not found"}</span>
                              ) : (
                                <span className={m.small}>—</span>
                              )}
                            </td>
                            <td className={m.flags}>
                              {r.dupe && <span className={`${m.flag} ${m.flagGrey}`}>already imported</span>}
                              {!r.dupe && r.overlap && <span className={m.flag}>tracker has this day</span>}
                              {r.warnings.map((w, k) => (
                                <span key={k} className={m.flag}>
                                  {w}
                                </span>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {rows.length > SHOW && !showAll && (
                  <p style={{ margin: "8px 0 0" }}>
                    <button type="button" className={`${styles.btn} ${styles.sec}`} onClick={() => setShowAll(true)}>
                      Show all {rows.length} rows
                    </button>{" "}
                    <span className={m.small}>Only the first {SHOW} are shown. The ticks apply to all of them.</span>
                  </p>
                )}

                <div style={{ marginTop: 14 }}>
                  <b>3. Map positions (optional)</b>
                  <p className={m.small} style={{ margin: "4px 0 6px" }}>
                    Trends works without these (streets, types, surfaces and chemicals all count). Positions add these tags to the map and the busiest-blocks list. They are looked up from OpenStreetMap by the two streets of the intersection, about one a second, and are approximate: use the &quot;found ↗&quot; link to check one. If two streets cross in more than one place the row is left without a position rather than guessed. You can fix a misspelled street in the Place box first.
                  </p>
                  <div className={m.actions}>
                    <button type="button" className={`${styles.btn} ${styles.sec}`} onClick={findPositions} disabled={geoBusy || needPos.length === 0} data-testid="imp-geo">
                      {geoBusy ? "Looking…" : needPos.length === 0 ? "Nothing left to look up" : `Find positions for ${plural(new Set(needPos.map((r) => normAddr(r.address))).size, "place")}`}
                    </button>
                    {geoBusy && (
                      <button type="button" className={`${styles.btn} ${styles.sec}`} onClick={() => (stop.current = true)}>
                        Stop
                      </button>
                    )}
                    {geoProg && (
                      <>
                        <span className={m.prog} aria-hidden>
                          <span className={m.progFill} style={{ width: `${geoProg.total ? (geoProg.done / geoProg.total) * 100 : 0}%` }} />
                        </span>
                        <span className={m.small} data-testid="imp-geo-sum">
                          {geoProg.done}/{geoProg.total} looked up · {geoCounts.found ?? 0} found · {geoCounts.several ?? 0} several matches · {geoCounts.none ?? 0} not found{geoCounts.error ? ` · ${geoCounts.error} failed` : ""}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <b>4. Import</b>
                  <div className={m.actions}>
                    <button type="button" className={`${styles.btn} ${styles.green}`} onClick={save} disabled={busy || geoBusy || chosen.length === 0} data-testid="imp-save">
                      {busy ? "Importing…" : `Import ${plural(chosen.length, "tag")}`}
                    </button>
                    <span className={m.small}>Importing the same file again is safe: tags already imported are skipped.</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className={styles.panel} data-testid="imp-batches">
          <b>Past imports</b>
          {batches === null ? (
            <p className={m.small}>Loading…</p>
          ) : batches.length === 0 ? (
            <p className={m.small}>Nothing imported yet.</p>
          ) : (
            <div className={m.tw}>
              <table className={m.tbl}>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>City</th>
                    <th>Tags</th>
                    <th>On map</th>
                    <th>Dates</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.batch}>
                      <td>{b.file ?? "—"}</td>
                      <td>{CITY_NAMES[b.city as City] ?? b.city}</td>
                      <td>{b.n}</td>
                      <td>{b.placed}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {shortDate(b.from)}
                        {b.to !== b.from ? ` – ${shortDate(b.to)}` : ""}
                      </td>
                      <td>
                        <button type="button" className={`${styles.btn} ${styles.red}`} onClick={() => undo(b)} data-testid="imp-undo">
                          Undo this import
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
