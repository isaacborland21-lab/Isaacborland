"use client";

import { useEffect, useState } from "react";
import styles from "./invoice.module.css";
import { CITIES, CITY_NAMES, City } from "@/lib/graffiti";
import { apiJson } from "../clientUtil";

type Periods = { seasons: { key: string; label: string; count: number }[]; years: { year: string; count: number }[] };

// Download finished tags for Google My Maps. Bozeman: one layer per season (pins colored by month).
// Helena: its own map, one layer per year. My Maps has no API, so this is a file you import.
export default function MyMapsPanel({ city: pageCity }: { city: City }) {
  const [city, setCity] = useState<City>(pageCity);
  const [periods, setPeriods] = useState<Periods | null>(null);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPeriods(null);
    setError(null);
    apiJson<Periods>(`/api/graffiti/mymaps?city=${city}`)
      .then((p) => {
        if (!alive) return;
        setPeriods(p);
        // Bozeman shares by season, Helena by year
        const first = city === "helena" ? (p.years[0] ? `year=${p.years[0].year}` : "") : p.seasons[0] ? `season=${p.seasons[0].key}` : "";
        setPick(first);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load."));
    return () => {
      alive = false;
    };
  }, [city, open]);

  const empty = periods !== null && periods.seasons.length === 0;

  return (
    <details className={styles.panel} data-testid="mymaps-panel" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Google My Maps export</summary>
      <div className={styles.ctl} role="group" aria-label="My Maps city" style={{ marginTop: 10 }}>
        {CITIES.map((k) => (
          <button
            key={k}
            type="button"
            className={`${styles.btn} ${city === k ? "" : styles.sec}`}
            aria-pressed={city === k}
            data-testid={`mm-city-${k}`}
            onClick={() => setCity(k)}
          >
            {CITY_NAMES[k]}
          </button>
        ))}
      </div>
      {error && <p className={styles.sub}>{error}</p>}
      {!periods && !error && <p className={styles.sub}>Loading…</p>}
      {empty && <p className={styles.sub}>No finished {CITY_NAMES[city]} tags yet.</p>}
      {periods && !empty && (
        <div className={styles.ctl} style={{ marginTop: 10 }}>
          <div>
            <label htmlFor="mm-pick">Layer</label>
            <select id="mm-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
              <optgroup label="Seasons">
                {periods.seasons.map((s) => (
                  <option key={s.key} value={`season=${s.key}`}>
                    {s.label} ({s.count})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Whole year">
                {periods.years.map((y) => (
                  <option key={y.year} value={`year=${y.year}`}>
                    {y.year} ({y.count})
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <div>
            <label>&nbsp;</label>
            <a className={`${styles.btn} ${styles.green}`} href={`/api/graffiti/mymaps?city=${city}&${pick}`} data-testid="mm-download">
              Download for My Maps (.csv)
            </a>
          </div>
        </div>
      )}
      <ol className={styles.sub} style={{ marginTop: 10, paddingLeft: 18, display: "block" }}>
        <li>
          Open your {CITY_NAMES[city]} map in Google My Maps. {city === "helena" ? "Helena gets one layer per year." : "Bozeman gets one layer per season."}
        </li>
        <li>Add layer, name it (e.g. the season), click Import and pick the file.</li>
        <li>Location: tick Latitude and Longitude. Title: choose Name.</li>
        <li>Click the layer&apos;s Uniform style, then Group places by: Month. Each month gets its own color (you can change them).</li>
        <li>
          To update the current season later: on that layer&apos;s menu choose Reimport and merge, then Replace all items, and pick the new file.
          The link you shared stays the same.
        </li>
      </ol>
    </details>
  );
}
