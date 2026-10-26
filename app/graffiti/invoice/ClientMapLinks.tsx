"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./invoice.module.css";
import { CITIES, CITY_NAMES, City } from "@/lib/graffiti";
import type { ShareLink } from "@/lib/clientMap";
import { apiJson } from "../clientUtil";

// Owner only: private links to the live client map (finished tags, colored by month, one toggle per season).
// Anyone with a link can view it without signing in; turning a link off stops it at once.
export default function ClientMapLinks() {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [city, setCity] = useState<City>("bozeman");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks((await apiJson<{ links: ShareLink[] }>("/api/graffiti/shares")).links);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load the links.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const urlOf = (t: string) => `${window.location.origin}/share/map/${t}`;

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      await apiJson("/api/graffiti/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ city, label }) });
      setLabel("");
      setMsg("Link created. Copy it and send it to the client.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not create the link.");
    }
    setBusy(false);
  }

  async function turnOff(l: ShareLink) {
    if (!window.confirm(`Turn off "${l.label || CITY_NAMES[l.city]}"? Anyone using that link will lose access right away.`)) return;
    setBusy(true);
    try {
      await apiJson("/api/graffiti/shares", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: l.token }) });
      setMsg("Link turned off.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not turn the link off.");
    }
    setBusy(false);
  }

  async function copy(t: string) {
    try {
      await navigator.clipboard.writeText(urlOf(t));
      setMsg("Link copied.");
    } catch {
      window.prompt("Copy this link:", urlOf(t));
    }
  }

  return (
    <details className={styles.panel} data-testid="client-links-panel">
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Live client map links</summary>
      <p className={styles.sub} style={{ marginTop: 8 }}>
        A private link to a live map of finished tags for one city. New tags show up on their own (the page refreshes every minute). Clients
        see where, when and the tag type, with pins colored by month and a button per season. They never see crew names, notes, photos,
        times or prices. Anyone with the link can view it, so only send it to the client.
      </p>
      <div className={styles.ctl} style={{ marginTop: 10 }}>
        <div>
          <label htmlFor="cl-city">City</label>
          <select id="cl-city" value={city} onChange={(e) => setCity(e.target.value as City)}>
            {CITIES.map((k) => (
              <option key={k} value={k}>
                {CITY_NAMES[k]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 200 }}>
          <label htmlFor="cl-label">Title clients see</label>
          <input id="cl-label" type="text" maxLength={80} placeholder={`Graffiti removal: ${CITY_NAMES[city]}`} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <label>&nbsp;</label>
          <button type="button" className={`${styles.btn} ${styles.green}`} disabled={busy} data-testid="cl-create" onClick={() => void create()}>
            Create link
          </button>
        </div>
      </div>
      {msg && (
        <p className={styles.sub} role="status">
          {msg}
        </p>
      )}
      {links && links.length === 0 && <p className={styles.sub}>No links yet.</p>}
      {links && links.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {links.map((l) => (
            <li key={l.token} data-testid="cl-link" style={{ padding: "8px 0", borderTop: "1px solid #e5e7eb" }}>
              <b>{l.label || `Graffiti removal: ${CITY_NAMES[l.city]}`}</b> <span className={styles.sub} style={{ display: "inline" }}>({CITY_NAMES[l.city]})</span>
              <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className={`${styles.btn} ${styles.sec}`} onClick={() => void copy(l.token)}>
                  Copy link
                </button>
                <a className={`${styles.btn} ${styles.sec}`} href={`/share/map/${l.token}`} target="_blank" rel="noreferrer" data-testid="cl-open">
                  Open
                </a>
                <button type="button" className={`${styles.btn} ${styles.red}`} disabled={busy} data-testid="cl-off" onClick={() => void turnOff(l)}>
                  Turn off
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
