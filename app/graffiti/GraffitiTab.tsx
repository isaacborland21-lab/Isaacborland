"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import styles from "./graffiti.module.css";
import {
  GRAFFITI_STATUSES,
  GRAFFITI_TYPES,
  GraffitiStatus,
  GraffitiType,
  Incident,
  MAX_MINUTES,
  STATUS_LABEL,
  TYPE_NAMES,
  fmtDur,
  typeName,
} from "@/lib/graffiti";
import {
  LeafletNS,
  TILE_ATTRIBUTION,
  TILE_URL,
  apiJson,
  loadLeaflet,
  lookupPlace,
  photoUrl,
  shrinkPhoto,
} from "./clientUtil";

/* eslint-disable @typescript-eslint/no-explicit-any */

const COLORS: Record<GraffitiStatus, string> = {
  reported: "#e5594f",
  scheduled: "#e3a73a",
  in_progress: "#4c8df0",
  removed: "#3fb06a",
};
const BADGE: Record<GraffitiStatus, string> = {
  reported: styles.bReported,
  scheduled: styles.bScheduled,
  in_progress: styles.bInProgress,
  removed: styles.bRemoved,
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";

function elapsedText(startIso: string): string {
  let s = Math.max(0, Math.floor((Date.now() - Date.parse(startIso)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  s %= 60;
  return (h ? `${h}:` : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(s).padStart(2, "0");
}

/** A running clock for one job (ticks on its own so the rest of the tab doesn't re-render every second). */
function Elapsed({ start, className }: { start: string; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className={className} data-testid="elapsed">
      {elapsedText(start)}
    </span>
  );
}

const readStore = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeStore = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* private mode etc.: not important */
  }
};

type Toast = (msg: string) => void;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/* ======================================================================
   Main tab
   ====================================================================== */

// how far (in screen pixels) the picked spot is from the middle of the little map; pixels, not meters,
// because at low zoom a half-pixel rounding wobble is already hundreds of meters
const offCenterPx = (map: any, lat: number, lng: number): number => {
  const p = map.latLngToContainerPoint([lat, lng]);
  const size = map.getSize();
  return Math.hypot(p.x - size.x / 2, p.y - size.y / 2);
};

export default function GraffitiTab({ isOwner }: { isOwner: boolean }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [view, setView] = useState<"list" | "map" | "add">("list");
  const [openId, setOpenId] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const [fStatus, setFStatus] = useState("");
  const [fSearch, setFSearch] = useState("");

  const toast = useCallback<Toast>((msg) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const load = useCallback(
    async (quiet = false) => {
      try {
        const data = await apiJson<{ incidents: Incident[]; truncated: boolean }>("/api/graffiti/incidents");
        setIncidents(data.incidents);
        setTruncated(data.truncated);
      } catch (e) {
        if (!quiet) toast(errMsg(e));
      }
      setLoaded(true);
    },
    [toast],
  );

  // first load, then keep fresh when the phone wakes up or every minute (so the crew sees each other's work)
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [load]);

  const upsert = useCallback((inc: Incident) => {
    setIncidents((prev) => (prev.some((x) => x.id === inc.id) ? prev.map((x) => (x.id === inc.id ? inc : x)) : [inc, ...prev]));
  }, []);

  const stats = useMemo(() => {
    const open = incidents.filter((i) => i.status === "reported" || i.status === "scheduled").length;
    const prog = incidents.filter((i) => i.status === "in_progress").length;
    const done = incidents.filter((i) => i.status === "removed").length;
    const ds = incidents.filter((i) => i.status === "removed" && i.duration_min != null).map((i) => i.duration_min as number);
    const avg = ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : null;
    return { open, prog, done, avg };
  }, [incidents]);

  const running = useMemo(() => incidents.filter((i) => i.status === "in_progress" && i.started_at), [incidents]);

  const rows = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return incidents.filter(
      (i) =>
        (!fStatus || i.status === fStatus) &&
        (!q || `${i.address ?? ""} ${i.description ?? ""} ${i.notes ?? ""} ${typeName(i.gtype)}`.toLowerCase().includes(q)),
    );
  }, [incidents, fStatus, fSearch]);

  const opened = openId !== null ? incidents.find((i) => i.id === openId) ?? null : null;

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h2 className={styles.title}>Graffiti removal tracker</h2>
        {isOwner && (
          <a className={styles.headLink} href="/graffiti/invoice">
            Invoice →
          </a>
        )}
      </div>

      <div className={styles.stats}>
        <div className={`${styles.chip} ${styles.cReported}`}>
          <b>{stats.open}</b>
          <span>Open</span>
        </div>
        <div className={`${styles.chip} ${styles.cProgress}`}>
          <b>{stats.prog}</b>
          <span>Active</span>
        </div>
        <div className={`${styles.chip} ${styles.cRemoved}`}>
          <b>{stats.done}</b>
          <span>Removed</span>
        </div>
        <div className={styles.chip}>
          <b>{stats.avg == null ? "-" : fmtDur(stats.avg)}</b>
          <span>Avg time</span>
        </div>
      </div>

      {running.map((i) => (
        <button key={i.id} type="button" className={styles.active} onClick={() => setOpenId(i.id)}>
          <span>
            <b>Job in progress</b>
            <span className={styles.small}>
              {(i.address || "Tap to take the after photo") + " · " + typeName(i.gtype)}
            </span>
          </span>
          <Elapsed start={i.started_at as string} className={styles.timer} />
        </button>
      ))}

      <nav className={styles.subnav} aria-label="Graffiti views">
        {(
          [
            ["list", "List"],
            ["map", "Map"],
            ["add", "+ Log new"],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" className={view === v ? styles.on : undefined} aria-pressed={view === v} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
      </nav>

      <section hidden={view !== "list"} aria-label="Incident list">
        <div className={styles.filters}>
          <select aria-label="Filter by status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">All statuses</option>
            {GRAFFITI_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <input type="text" aria-label="Search" placeholder="Search street / notes" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        </div>
        {!loaded ? (
          <div className={styles.empty}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>{incidents.length ? "Nothing matches." : "No incidents logged yet. Tap + Log new."}</div>
        ) : (
          rows.map((i) => {
            const src = photoUrl(i.after_photo || i.before_photo);
            return (
              <button key={i.id} type="button" className={styles.card} onClick={() => setOpenId(i.id)}>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.thumb} src={src} alt="" loading="lazy" />
                ) : (
                  <span className={styles.thumb} />
                )}
                <div>
                  <span className={`${styles.badge} ${BADGE[i.status]}`}>{STATUS_LABEL[i.status]}</span>
                  <div className={styles.cardTitle}>{i.address || `${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}`}</div>
                  <div className={styles.cardMeta}>
                    {`${typeName(i.gtype)} · ${fmtDate(i.reported_at)}` + (i.duration_min != null ? ` · ${fmtDur(i.duration_min)}` : "")}
                  </div>
                </div>
              </button>
            );
          })
        )}
        {truncated && <div className={styles.note}>Showing the newest 900 incidents.</div>}
      </section>

      <section hidden={view !== "map"} aria-label="Map">
        <MapView incidents={incidents} active={view === "map"} onOpen={setOpenId} />
      </section>

      <section hidden={view !== "add"} aria-label="Log a new incident">
        <AddForm
          active={view === "add"}
          toast={toast}
          onCreated={(inc) => {
            upsert(inc);
            setView("list");
          }}
        />
      </section>

      {opened && (
        <IncidentSheet
          key={opened.id}
          inc={opened}
          canDelete={isOwner || opened.mine === true}
          toast={toast}
          onClose={() => setOpenId(null)}
          onSaved={upsert}
          onDeleted={(id) => setIncidents((prev) => prev.filter((x) => x.id !== id))}
        />
      )}

      {toastMsg && (
        <div className={styles.toast} role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

/* ======================================================================
   Map view
   ====================================================================== */

function MapView({ incidents, active, onOpen }: { incidents: Incident[]; active: boolean; onOpen: (id: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [filter, setFilter] = useState<"open" | "" | "removed">("open");
  const [err, setErr] = useState<string | null>(null);
  const latest = useRef({ incidents, filter });
  latest.current = { incidents, filter };

  const draw = useCallback((fit: boolean) => {
    const L = (window as any).L as LeafletNS | undefined;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const { incidents: all, filter: f } = latest.current;
    const shown = all.filter((i) => (f === "open" ? i.status !== "removed" : !f || i.status === f));
    const pts: [number, number][] = [];
    for (const i of shown) {
      const m = L.circleMarker([i.lat, i.lng], { radius: 11, color: "#fff", weight: 2, fillColor: COLORS[i.status], fillOpacity: 0.95 });
      m.on("click", () => onOpenRef.current(i.id));
      m.addTo(layer);
      pts.push([i.lat, i.lng]);
    }
    if (fit && pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 17 });
    else if (fit && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => map.setView([p.coords.latitude, p.coords.longitude], 14),
        () => {},
        { timeout: 8000 },
      );
    }
  }, []);

  // on a phone the page header is tall: bring the map to the top so none of it hides behind the bottom bar
  useEffect(() => {
    if (active && window.matchMedia("(max-width: 720px)").matches) {
      top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [active]);

  // create the map the first time the Map view is shown
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !box.current) return;
        if (!mapRef.current) {
          const map = L.map(box.current).setView([39.5, -98.35], 4);
          L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
          layerRef.current = L.layerGroup().addTo(map);
          mapRef.current = map;
        }
        window.setTimeout(() => {
          mapRef.current?.invalidateSize();
          draw(true);
        }, 50);
      })
      .catch((e) => !cancelled && setErr(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [active, draw]);

  useEffect(() => draw(false), [incidents, draw]);
  useEffect(() => draw(true), [filter, draw]);
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    },
    [],
  );

  return (
    <>
      <div ref={top} className={styles.filters} style={{ scrollMarginTop: 12 }}>
        <select aria-label="Map filter" style={{ flex: 1 }} value={filter} onChange={(e) => setFilter(e.target.value as "open" | "" | "removed")}>
          <option value="open">Open (not removed yet)</option>
          <option value="">Everything</option>
          <option value="removed">Removed only</option>
        </select>
      </div>
      <div ref={box} className={styles.map} data-testid="map">
        {err && <div className={styles.mapErr}>{err}</div>}
      </div>
      <div className={styles.legend}>
        {GRAFFITI_STATUSES.map((s) => (
          <span key={s}>
            <i className={styles.dot} style={{ background: COLORS[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
    </>
  );
}

/* ======================================================================
   Log a new incident
   ====================================================================== */

function AddForm({ active, toast, onCreated }: { active: boolean; toast: Toast; onCreated: (inc: Incident) => void }) {
  const [address, setAddressState] = useState("");
  const [description, setDescription] = useState("");
  const [gtype, setGtype] = useState<GraffitiType>("ssr");
  const [mode, setMode] = useState<"report" | "done">("report");
  const [minutes, setMinutes] = useState("");
  const [hint, setHint] = useState("Getting your GPS location...");
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);
  const [pending, setPending] = useState<{ file: File; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [mapErr, setMapErr] = useState<string | null>(null);

  // values read after awaits must be current, not stale from the render that started the work
  const latest = useRef({ address: "", description: "", gtype: "ssr" as GraffitiType });
  latest.current.description = description;
  latest.current.gtype = gtype;
  const setAddress = useCallback((v: string) => {
    latest.current.address = v;
    setAddressState(v);
  }, []);

  const pickedRef = useRef<{ lat: number; lng: number } | null>(null);
  const dirty = useRef(false); // the crew typed their own address: don't overwrite it
  const seq = useRef(0);
  const lookupRef = useRef<Promise<void>>(Promise.resolve());
  const submitting = useRef(false);
  const gpsTried = useRef(false);
  const pendingRef = useRef<{ file: File; at: number } | null>(null);
  pendingRef.current = pending;

  const pickBox = useRef<HTMLDivElement>(null);
  const pickMap = useRef<any>(null);
  const quiet = useRef(false); // true while WE move the little map, so that move is not mistaken for the crew dragging it

  // remember the last tag type
  useEffect(() => {
    const t = readStore("gt_type");
    if (t && (GRAFFITI_TYPES as readonly string[]).includes(t)) setGtype(t as GraffitiType);
  }, []);

  const lookup = useCallback(
    (lat: number, lng: number) => {
      const my = ++seq.current;
      setHint("Looking up the nearest intersection...");
      const p = (async () => {
        const label = await lookupPlace(lat, lng);
        if (my !== seq.current) return;
        if (label && !dirty.current) setAddress(label);
        setHint(
          label
            ? "Filled in from the pin. Fix it if it is off (mid-block spots show the closest corner)."
            : "Could not look up the street. Type the intersection.",
        );
      })();
      lookupRef.current = p;
      return p;
    },
    [setAddress],
  );

  // The pin is fixed in the middle of the little map (see pickPin in the CSS). Moving the map moves the
  // pin; this just keeps the map centered on the picked spot when the pick came from somewhere else
  // (GPS, a map tap, a new fix).
  const placeMarker = useCallback((zoom: boolean) => {
    const map = pickMap.current;
    const pk = pickedRef.current;
    if (!map || !pk) return;
    quiet.current = true;
    try {
      if (zoom) map.setView([pk.lat, pk.lng], 18, { animate: false });
      else if (offCenterPx(map, pk.lat, pk.lng) >= 1.5) map.setView([pk.lat, pk.lng], map.getZoom(), { animate: false });
    } finally {
      quiet.current = false;
    }
  }, []);

  const setPick = useCallback(
    (lat: number, lng: number, zoom: boolean) => {
      pickedRef.current = { lat, lng };
      setPicked({ lat, lng });
      dirty.current = false;
      placeMarker(zoom);
      return lookup(lat, lng);
    },
    [lookup, placeMarker],
  );

  const getGps = useCallback(() => {
    if (!navigator.geolocation) {
      setHint('GPS not available here. Open "Adjust pin on map" and move the map to the spot.');
      setMapOpen(true);
      return;
    }
    setGpsBusy(true);
    setHint("Getting your GPS location...");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGpsBusy(false);
        void setPick(p.coords.latitude, p.coords.longitude, true);
      },
      () => {
        setGpsBusy(false);
        setHint(
          pendingRef.current
            ? "Photo taken and its start time is saved. Move the map to put the pin on the spot and the job will save."
            : 'No GPS. Allow location access, or open "Adjust pin on map" and move the map to the spot.',
        );
        setMapOpen(true);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }, [setPick]);

  // ask for GPS the first time this view is shown
  useEffect(() => {
    if (active && !gpsTried.current && !pickedRef.current) {
      gpsTried.current = true;
      getGps();
    }
  }, [active, getGps]);

  // the small "adjust pin" map is created when the section is opened
  useEffect(() => {
    if (!mapOpen) return;
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !pickBox.current) return;
        if (!pickMap.current) {
          const map = L.map(pickBox.current).setView([39.5, -98.35], 4);
          L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
          // the pin sits in the middle of the map, so when the map stops moving the pick is the map center
          map.on("moveend", () => {
            if (quiet.current) return;
            const c = map.getCenter();
            const pk = pickedRef.current;
            // ignore moves we caused ourselves (map already centered on the pick)
            if (pk && offCenterPx(map, pk.lat, pk.lng) < 1.5) return;
            void setPick(c.lat, c.lng, false);
          });
          // tapping the map slides that spot under the pin
          map.on("click", (e: any) => map.panTo(e.latlng));
          pickMap.current = map;
        }
        window.setTimeout(() => {
          quiet.current = true;
          try {
            pickMap.current?.invalidateSize({ pan: false, animate: false });
          } finally {
            quiet.current = false;
          }
          placeMarker(true);
        }, 60);
      })
      .catch((e) => !cancelled && setMapErr(errMsg(e)));
    return () => {
      cancelled = true;
    };
  }, [mapOpen, setPick, placeMarker]);
  useEffect(
    () => () => {
      pickMap.current?.remove();
      pickMap.current = null;
    },
    [],
  );

  function resetForm() {
    setPending(null);
    pickedRef.current = null;
    setPicked(null);
    dirty.current = false;
    gpsTried.current = false;
    seq.current++;
    setAddress("");
    setDescription("");
    setMinutes("");
    setMode("report");
    setMapOpen(false);
    setOtherOpen(false);
    setHint("Getting your GPS location...");
  }

  // before photo: saves the job and starts the clock at the moment the photo was taken
  function onBeforePhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    // keep the earliest photo time if a previous save attempt failed
    setPending((p) => ({ file: f, at: p ? p.at : Date.now() }));
    if (!pickedRef.current) {
      setHint("Photo taken. Waiting for GPS, then the job saves with the clock started at the photo time.");
      if (!gpsBusy) getGps();
    }
  }

  async function submitStart() {
    const p = pending;
    const pk = pickedRef.current;
    if (submitting.current || !p || !pk) return;
    submitting.current = true;
    setBusy(true);
    try {
      // let the street name land first (but never wait more than 8 seconds)
      await Promise.race([lookupRef.current, new Promise((r) => window.setTimeout(r, 8000))]);
      const fd = new FormData();
      fd.set("mode", "start");
      fd.set("lat", String(pk.lat));
      fd.set("lng", String(pk.lng));
      fd.set("address", latest.current.address);
      fd.set("gtype", latest.current.gtype);
      fd.set("description", latest.current.description);
      fd.set("photo_at", String(p.at));
      fd.set("photo", await shrinkPhoto(p.file), "before.jpg");
      const { incident } = await apiJson<{ incident: Incident }>("/api/graffiti/incidents", { method: "POST", body: fd });
      resetForm();
      onCreated(incident);
      toast("Timer started at the photo time");
    } catch (e) {
      toast(`Not saved: ${errMsg(e)} Take the photo again to retry (the start time is kept).`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  // as soon as a photo AND a GPS fix both exist, the job saves
  useEffect(() => {
    if (pending && picked) void submitStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, picked]);

  // secondary path: no photo timer (report only / already done)
  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const pk = pickedRef.current;
    if (!pk) return toast("Still waiting on GPS. Open Adjust pin on map and move the map to the spot.");
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("mode", mode);
      fd.set("lat", String(pk.lat));
      fd.set("lng", String(pk.lng));
      fd.set("address", latest.current.address);
      fd.set("gtype", gtype);
      fd.set("description", description);
      if (mode === "done") fd.set("duration_min", minutes);
      const { incident } = await apiJson<{ incident: Incident }>("/api/graffiti/incidents", { method: "POST", body: fd });
      resetForm();
      onCreated(incident);
      toast("Saved");
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label className={styles.lbl} htmlFor="gt-address">
        Location / intersection
      </label>
      <div className={styles.loc}>
        <input
          id="gt-address"
          type="text"
          maxLength={255}
          placeholder="Finding you..."
          value={address}
          onChange={(e) => {
            dirty.current = true;
            setAddress(e.target.value);
          }}
        />
        <button
          type="button"
          className={`${styles.btn} ${styles.sec}`}
          disabled={gpsBusy}
          title="Re-check GPS"
          onClick={() => {
            dirty.current = false;
            getGps();
          }}
        >
          ↻ GPS
        </button>
      </div>
      <div className={styles.hint} data-testid="loc-hint">
        {hint}
      </div>
      <details className={styles.details} open={mapOpen} onToggle={(e) => setMapOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Adjust pin on map</summary>
        <div className={styles.pickWrap}>
          <div ref={pickBox} className={styles.pickMap} data-testid="pick-map">
            {mapErr && <div className={styles.mapErr}>{mapErr}</div>}
          </div>
          {!mapErr && (
            <svg className={styles.pickPin} data-testid="pick-pin" width="30" height="42" viewBox="0 0 30 42" aria-hidden="true">
              <path d="M15 41C15 41 2 26 2 15a13 13 0 0 1 26 0c0 11-13 26-13 26z" fill="#e5594f" stroke="#fff" strokeWidth="2.5" />
              <circle cx="15" cy="15" r="5" fill="#fff" />
            </svg>
          )}
        </div>
        <div className={styles.hint}>Drag the map so the pin sits on the tag. The street name updates when you let go.</div>
      </details>

      <span className={styles.lbl}>Type of tag</span>
      <div className={styles.opts} role="radiogroup" aria-label="Type of tag">
        {GRAFFITI_TYPES.map((t) => (
          <label key={t} className={styles.opt}>
            <input
              type="radio"
              name="gtype"
              value={t}
              checked={gtype === t}
              onChange={() => {
                setGtype(t);
                writeStore("gt_type", t);
              }}
            />
            <span>{TYPE_NAMES[t]}</span>
          </label>
        ))}
      </div>

      <label className={styles.lbl} htmlFor="gt-desc">
        Notes (optional)
      </label>
      <textarea
        id="gt-desc"
        maxLength={2000}
        placeholder="Size, paint type, access issues, owner contact..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label className={`${styles.photobtn} ${busy ? styles.busy : ""}`}>
        <input type="file" accept="image/*" capture="environment" data-testid="before-input" onChange={onBeforePhoto} />
        Take before photo
        <small>Saves the job and starts the timer</small>
      </label>
      <div className={styles.hint}>Set the tag type first. The clock starts the moment the photo is taken.</div>

      <details className={styles.details} open={otherOpen} onToggle={(e) => setOtherOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Log without the photo timer</summary>
        <div className={styles.opts} style={{ marginTop: 10 }}>
          <label className={`${styles.opt} ${styles.sm}`}>
            <input type="radio" name="mode" checked={mode === "report"} onChange={() => setMode("report")} />
            <span>Report only (no work yet)</span>
          </label>
          <label className={`${styles.opt} ${styles.sm}`}>
            <input type="radio" name="mode" checked={mode === "done"} onChange={() => setMode("done")} />
            <span>Already done</span>
          </label>
        </div>
        {mode === "done" && (
          <>
            <label className={styles.lbl} htmlFor="gt-min">
              Minutes it took
            </label>
            <input
              id="gt-min"
              type="number"
              min={0}
              max={MAX_MINUTES}
              inputMode="numeric"
              placeholder="e.g. 25"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </>
        )}
        <button type="submit" className={`${styles.btn} ${styles.sec} ${styles.block}`} style={{ marginTop: 12 }} disabled={saving}>
          {saving ? "Saving..." : mode === "done" ? "Save completed job" : "Save report"}
        </button>
      </details>
    </form>
  );
}

/* ======================================================================
   Incident detail sheet
   ====================================================================== */

function PhotoFig({ label, name }: { label: string; name: string | null }) {
  const u = photoUrl(name);
  return (
    <figure>
      <figcaption>{label}</figcaption>
      {u ? (
        <a href={u} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt={`${label} photo`} loading="lazy" />
        </a>
      ) : (
        <div className={styles.ph}>No photo</div>
      )}
    </figure>
  );
}

function PhotoButton({ text, sub, go, disabled, onPhoto }: { text: string; sub: string; go?: boolean; disabled: boolean; onPhoto: (f: File, at: number) => void }) {
  return (
    <label className={`${styles.photobtn} ${go ? styles.go : ""} ${disabled ? styles.busy : ""}`}>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        data-testid={go ? "after-input" : "start-input"}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPhoto(f, Date.now());
        }}
      />
      {text}
      <small>{sub}</small>
    </label>
  );
}

function IncidentSheet({
  inc,
  canDelete,
  toast,
  onClose,
  onSaved,
  onDeleted,
}: {
  inc: Incident;
  canDelete: boolean;
  toast: Toast;
  onClose: () => void;
  onSaved: (inc: Incident) => void;
  onDeleted: (id: number) => void;
}) {
  const [addr, setAddr] = useState(inc.address ?? "");
  const [notes, setNotes] = useState(inc.notes ?? "");
  const [sched, setSched] = useState(inc.scheduled_for ?? "");
  const [mins, setMins] = useState(inc.duration_min != null ? String(inc.duration_min) : "");
  const [gtype, setGtype] = useState<GraffitiType>(inc.gtype);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function save(extra: Record<string, string> = {}, photo?: File, message = "Updated") {
    if (busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("address", addr);
      fd.set("gtype", gtype);
      fd.set("notes", notes);
      fd.set("scheduled_for", sched);
      fd.set("duration_min", mins);
      for (const [k, v] of Object.entries(extra)) fd.set(k, v);
      if (photo) fd.set("photo", await shrinkPhoto(photo), "photo.jpg");
      const { incident } = await apiJson<{ incident: Incident }>(`/api/graffiti/incidents/${inc.id}`, { method: "PATCH", body: fd });
      onSaved(incident);
      toast(message);
      onClose();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this incident and its photos? This cannot be undone.")) return;
    setBusy(true);
    try {
      await apiJson<{ ok: true }>(`/api/graffiti/incidents/${inc.id}`, { method: "DELETE" });
      onDeleted(inc.id);
      toast("Deleted");
      onClose();
    } catch (e) {
      toast(errMsg(e));
      setBusy(false);
    }
  }

  const meta =
    `${typeName(inc.gtype)} · reported ${fmtDate(inc.reported_at)}` +
    (inc.started_at ? ` · started ${fmtTime(inc.started_at)}` : "") +
    (inc.finished_at ? ` · finished ${fmtTime(inc.finished_at)}` : "");

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Incident details">
        <span className={`${styles.badge} ${BADGE[inc.status]}`}>{STATUS_LABEL[inc.status]}</span>
        <h2>{inc.address || `${inc.lat.toFixed(5)}, ${inc.lng.toFixed(5)}`}</h2>
        <div className={styles.small}>{meta}</div>
        {inc.description && <p>{inc.description}</p>}

        {inc.status === "in_progress" && inc.started_at && <Elapsed start={inc.started_at} className={styles.bigtimer} />}
        {inc.status === "removed" && inc.duration_min != null && (
          <div className={`${styles.bigtimer} ${styles.done}`}>{fmtDur(inc.duration_min)}</div>
        )}

        <div className={styles.photos}>
          <PhotoFig label="Before" name={inc.before_photo} />
          <PhotoFig label="After" name={inc.after_photo} />
        </div>

        {inc.status === "in_progress" && (
          <div>
            <PhotoButton
              go
              disabled={busy}
              text="Take after photo"
              sub="Finishes the job and stops the timer"
              onPhoto={(f, at) => save({ act: "finish", photo_at: String(at) }, f, "Job finished")}
            />
            <div style={{ textAlign: "center" }}>
              <button type="button" className={styles.linkbtn} disabled={busy} onClick={() => save({ act: "finish" }, undefined, "Job finished")}>
                Finish without a photo
              </button>
            </div>
          </div>
        )}
        {inc.status !== "in_progress" && inc.status !== "removed" && (
          <div>
            <PhotoButton
              disabled={busy}
              text="Take before photo"
              sub="Starts the timer"
              onPhoto={(f, at) => save({ act: "start", photo_at: String(at) }, f, "Timer started")}
            />
            <div style={{ textAlign: "center" }}>
              <button type="button" className={styles.linkbtn} disabled={busy} onClick={() => save({ act: "start" }, undefined, "Timer started")}>
                Start timer without a photo
              </button>
            </div>
          </div>
        )}
        {inc.status === "removed" && (
          <>
            <span className={styles.lbl}>Replace after photo</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              data-testid="replace-after"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void save({ photo_kind: "after" }, f, "Photo replaced");
              }}
            />
          </>
        )}

        <span className={styles.lbl}>Status</span>
        <div className={styles.seg}>
          {GRAFFITI_STATUSES.map((s) => (
            <button key={s} type="button" disabled={busy} className={`${styles.btn} ${styles.sec} ${inc.status === s ? styles.cur : ""}`} onClick={() => save({ status: s })}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <label className={styles.lbl} htmlFor="gs-min">
          Time on site (minutes)
        </label>
        <input
          id="gs-min"
          type="number"
          min={0}
          max={MAX_MINUTES}
          inputMode="numeric"
          placeholder={inc.status === "in_progress" ? "auto from the photos" : "minutes"}
          value={mins}
          onChange={(e) => setMins(e.target.value)}
        />
        <div className={styles.hint}>Set automatically from the before and after photo times. Type a number to override.</div>

        <label className={styles.lbl} htmlFor="gs-addr">
          Location / intersection
        </label>
        <input id="gs-addr" type="text" maxLength={255} placeholder="Street / intersection" value={addr} onChange={(e) => setAddr(e.target.value)} />

        <label className={styles.lbl} htmlFor="gs-type">
          Type of tag
        </label>
        <select id="gs-type" value={gtype} onChange={(e) => setGtype(e.target.value as GraffitiType)}>
          {GRAFFITI_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_NAMES[t]}
            </option>
          ))}
        </select>

        <label className={styles.lbl} htmlFor="gs-sched">
          Scheduled for
        </label>
        <input id="gs-sched" type="date" value={sched} onChange={(e) => setSched(e.target.value)} />

        <label className={styles.lbl} htmlFor="gs-notes">
          Notes
        </label>
        <textarea id="gs-notes" maxLength={2000} placeholder="Crew notes, product used, follow-up needed..." value={notes} onChange={(e) => setNotes(e.target.value)} />

        <div className={styles.row} style={{ marginTop: 16 }}>
          <button type="button" className={styles.btn} disabled={busy} onClick={() => save()}>
            Save changes
          </button>
          <button type="button" className={`${styles.btn} ${styles.sec}`} onClick={onClose}>
            Close
          </button>
        </div>
        <p>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${inc.lat},${inc.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)" }}
          >
            Navigate here
          </a>
        </p>
        {canDelete && (
          <button type="button" className={`${styles.btn} ${styles.danger} ${styles.block}`} disabled={busy} onClick={remove}>
            Delete incident
          </button>
        )}
      </div>
    </div>
  );
}
