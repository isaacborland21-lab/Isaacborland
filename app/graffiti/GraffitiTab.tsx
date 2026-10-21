"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import styles from "./graffiti.module.css";
import {
  CHEMICAL_OPTIONS,
  SURFACE_OPTIONS,
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
  detailsMessage,
  missingDetails,
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

export default function GraffitiTab({ isOwner, canInvoice = isOwner }: { isOwner: boolean; canInvoice?: boolean }) {
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

  // ids we have already seen, so a report from another phone can be announced when it shows up
  const knownIds = useRef<Set<number> | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      try {
        const data = await apiJson<{ incidents: Incident[]; truncated: boolean }>("/api/graffiti/incidents");
        setIncidents(data.incidents);
        setTruncated(data.truncated);
        const known = knownIds.current;
        knownIds.current = new Set(data.incidents.map((i) => i.id));
        if (known && quiet) {
          const fresh = data.incidents.filter((i) => !known.has(i.id) && i.status === "reported" && !i.mine);
          if (fresh.length === 1) {
            const f = fresh[0];
            toast(`${f.urgent ? "URGENT report" : "New report"}: ${f.address || "see the list"}`);
          } else if (fresh.length > 1) {
            const u = fresh.filter((f) => f.urgent).length;
            toast(`${fresh.length} new reports${u ? ` (${u} urgent)` : ""}`);
          }
        }
      } catch (e) {
        if (!quiet) toast(errMsg(e));
      }
      setLoaded(true);
    },
    [toast],
  );

  // first load, then keep fresh when the phone wakes up or every 15 seconds (so the crew sees each other's reports and work)
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, 15_000);
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
    const isOpen = (i: Incident) => i.status === "reported" || i.status === "scheduled";
    const list = incidents.filter(
      (i) =>
        (!fStatus || (fStatus === "needs" ? isOpen(i) : i.status === fStatus)) &&
        (!q || `${i.address ?? ""} ${i.description ?? ""} ${i.notes ?? ""} ${i.reported_by_name ?? ""} ${typeName(i.gtype)}`.toLowerCase().includes(q)),
    );
    // urgent reports that still need removing go to the top (otherwise newest first, as loaded)
    return [...list.filter((i) => i.urgent && isOpen(i)), ...list.filter((i) => !(i.urgent && isOpen(i)))];
  }, [incidents, fStatus, fSearch]);

  const opened = openId !== null ? incidents.find((i) => i.id === openId) ?? null : null;

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h2 className={styles.title}>Graffiti removal tracker</h2>
        {(isOwner || canInvoice) && (
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
            <option value="needs">Needs removal</option>
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
            const src = photoUrl(i.after_photo || i.before_photo || i.report_photo);
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
                  {i.urgent && i.status !== "removed" && <span className={`${styles.badge} ${styles.bUrgent}`}>Urgent</span>}
                  <div className={styles.cardTitle}>{i.address || `${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}`}</div>
                  <div className={styles.cardMeta}>
                    {`${typeName(i.gtype)} · ${fmtDate(i.reported_at)}` + (i.duration_min != null ? ` · ${fmtDur(i.duration_min)}` : "")}
                  </div>
                  {(i.reported_by_name || i.claimed_by_name || i.removed_by_name) && (
                    <div className={styles.cardMeta}>
                      {[
                        i.reported_by_name ? `Reported by ${i.reported_by_name}` : "",
                        i.status === "removed" && i.removed_by_name
                          ? `Removed by ${i.removed_by_name}`
                          : i.claimed_by_name
                            ? `Taken by ${i.claimed_by_me ? "you" : i.claimed_by_name}`
                            : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
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

// The Map tab only covers the Bozeman area (Bozeman, Belgrade, Four Corners, Gallatin Gateway, Bridger Canyon).
const BOZEMAN_CENTER: [number, number] = [45.677, -111.0386];
const BOZEMAN_BOUNDS: [[number, number], [number, number]] = [
  [45.55, -111.3],
  [45.82, -110.85],
];
const inBozeman = (lat: number, lng: number) =>
  lat >= BOZEMAN_BOUNDS[0][0] && lat <= BOZEMAN_BOUNDS[1][0] && lng >= BOZEMAN_BOUNDS[0][1] && lng <= BOZEMAN_BOUNDS[1][1];

function MapView({ incidents, active, onOpen }: { incidents: Incident[]; active: boolean; onOpen: (id: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [filter, setFilter] = useState<"open" | "" | "removed">("open");
  const [err, setErr] = useState<string | null>(null);
  const [outside, setOutside] = useState(0);
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
    let away = 0;
    for (const i of shown) {
      if (!inBozeman(i.lat, i.lng)) {
        away++;
        continue;
      }
      const m = L.circleMarker([i.lat, i.lng], { radius: 11, color: "#fff", weight: 2, fillColor: COLORS[i.status], fillOpacity: 0.95 });
      m.on("click", () => onOpenRef.current(i.id));
      m.addTo(layer);
      pts.push([i.lat, i.lng]);
    }
    setOutside(away);
    if (fit && pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 17 });
    else if (fit) map.setView(BOZEMAN_CENTER, 12);
    if (fit && !pts.length && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          // only jump to the phone's location when it is inside the Bozeman area
          if (inBozeman(p.coords.latitude, p.coords.longitude)) map.setView([p.coords.latitude, p.coords.longitude], 14);
        },
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
          // the map cannot be dragged or zoomed out past the Bozeman area
          const map = L.map(box.current, { maxBounds: BOZEMAN_BOUNDS, maxBoundsViscosity: 1, minZoom: 9 }).setView(BOZEMAN_CENTER, 12);
          L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
          layerRef.current = L.layerGroup().addTo(map);
          mapRef.current = map;
        }
        window.setTimeout(() => {
          const m = mapRef.current;
          if (m) {
            m.invalidateSize();
            // never zoom out far enough to show anything outside the area
            m.setMinZoom(Math.max(9, m.getBoundsZoom(BOZEMAN_BOUNDS, true)));
          }
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
      {outside > 0 && (
        <div className={styles.hint} data-testid="map-outside">
          {outside} {outside === 1 ? "tag is" : "tags are"} outside the Bozeman area and not shown here (see the List).
        </div>
      )}
    </>
  );
}

/* ======================================================================
   Log a new incident
   ====================================================================== */

/** A short pick-list plus an "Other" box for anything not on it. The value is plain text. */
function PickField({
  id,
  label,
  options,
  value,
  onChange,
  disabled,
  required,
  invalid,
}: {
  id: string;
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** shows the asterisk; `invalid` (after a blocked attempt) outlines it in red */
  required?: boolean;
  invalid?: boolean;
}) {
  const known = options.filter((o) => o !== "Other");
  const [other, setOther] = useState(false);
  const custom = other || (value !== "" && !known.includes(value));
  const selected = custom ? "__other" : value;
  return (
    <div className={styles.pick}>
      <label className={styles.lbl} htmlFor={id}>
        {label}
        {required && <span className={styles.req}> *</span>}
      </label>
      <select
        id={id}
        value={selected}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        className={invalid ? styles.invalid : undefined}
        onChange={(e) => {
          if (e.target.value === "__other") {
            setOther(true);
            if (known.includes(value)) onChange("");
          } else {
            setOther(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">{required ? "Choose…" : "Not sure / skip"}</option>
        {known.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__other">Other…</option>
      </select>
      {custom && (
        <input
          type="text"
          aria-label={`${label}: describe`}
          placeholder="Type it in"
          maxLength={80}
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={invalid ? styles.invalid : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function AddForm({ active, toast, onCreated }: { active: boolean; toast: Toast; onCreated: (inc: Incident) => void }) {
  const [address, setAddressState] = useState("");
  const [description, setDescription] = useState("");
  const [gtype, setGtype] = useState<GraffitiType>("ssr");
  // "remove": I'm at the tag and about to remove it (before photo starts the clock).
  // "report": I'm just reporting it so somebody else can remove it.
  const [intent, setIntent] = useState<"remove" | "report">("remove");
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [reportPreview, setReportPreview] = useState<string | null>(null);
  const [urgent, setUrgent] = useState(false);
  const [surface, setSurface] = useState("");
  const [chemical, setChemical] = useState("");
  const [showErr, setShowErr] = useState(false); // outline the blank required details after a blocked photo
  const [formKey, setFormKey] = useState(0); // remounts the pick-lists after a save so "Other" boxes close
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
  const latest = useRef({ address: "", description: "", gtype: "ssr" as GraffitiType, surface: "", chemical: "" });
  latest.current.description = description;
  latest.current.gtype = gtype;
  latest.current.surface = surface;
  latest.current.chemical = chemical;
  const setAddress = useCallback((v: string) => {
    latest.current.address = v;
    setAddressState(v);
  }, []);

  // what it's on is needed before any photo; the chemical too once you are removing it (the tag type always has a value)
  const lacking = missingDetails({ surface, chemical }, intent === "remove");
  const locked = lacking.length > 0;
  function blockIfLocked(): boolean {
    if (!locked) return false;
    setShowErr(true);
    toast(detailsMessage(lacking));
    return true;
  }

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
    const c = readStore("gt_chem");
    if (c) setChemical(c);
  }, []);

  // small preview of the report photo
  useEffect(() => {
    if (!reportFile) {
      setReportPreview(null);
      return;
    }
    const u = URL.createObjectURL(reportFile);
    setReportPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [reportFile]);

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
    setReportFile(null);
    setUrgent(false);
    setSurface("");
    setShowErr(false);
    setFormKey((k) => k + 1);
    setMapOpen(false);
    setOtherOpen(false);
    setHint("Getting your GPS location...");
  }

  // before photo: saves the job and starts the clock at the moment the photo was taken
  function onBeforePhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (blockIfLocked()) return;
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
      fd.set("surface", latest.current.surface);
      fd.set("chemical", latest.current.chemical);
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
    if (blockIfLocked()) return;
    const pk = pickedRef.current;
    if (!pk) return toast("Still waiting on GPS. Open Adjust pin on map and move the map to the spot.");
    setSaving(true);
    try {
      const reporting = intent === "report";
      const fd = new FormData();
      fd.set("mode", reporting ? "report" : "done");
      fd.set("lat", String(pk.lat));
      fd.set("lng", String(pk.lng));
      fd.set("address", latest.current.address);
      fd.set("gtype", gtype);
      fd.set("description", description);
      fd.set("surface", surface);
      if (!reporting) fd.set("chemical", chemical);
      if (reporting) {
        if (urgent) fd.set("urgent", "1");
        if (reportFile) fd.set("photo", await shrinkPhoto(reportFile), "report.jpg");
      } else {
        fd.set("duration_min", minutes);
      }
      const { incident } = await apiJson<{ incident: Incident }>("/api/graffiti/incidents", { method: "POST", body: fd });
      resetForm();
      onCreated(incident);
      toast(reporting ? "Reported. The crew can see it now." : "Saved");
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className={styles.intent} role="radiogroup" aria-label="What are you doing?">
        <label className={styles.opt}>
          <input type="radio" name="intent" checked={intent === "remove"} onChange={() => setIntent("remove")} data-testid="intent-remove" />
          <span>
            I'm removing it
            <small>Timer starts at the before photo</small>
          </span>
        </label>
        <label className={styles.opt}>
          <input type="radio" name="intent" checked={intent === "report"} onChange={() => setIntent("report")} data-testid="intent-report" />
          <span>
            Report it
            <small>Someone else will remove it</small>
          </span>
        </label>
      </div>

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

      <div className={styles.picks} key={formKey}>
        <PickField id="gt-surface" label="What it's on" options={SURFACE_OPTIONS} value={surface} onChange={setSurface} required invalid={showErr && !surface.trim()} />
        {intent === "remove" && (
          <PickField
            id="gt-chem"
            label="Chemical used"
            options={CHEMICAL_OPTIONS}
            required
            invalid={showErr && !chemical.trim()}
            value={chemical}
            onChange={(v) => {
              setChemical(v);
              writeStore("gt_chem", v);
            }}
          />
        )}
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

      {intent === "report" ? (
        <Fragment key="report">
          <label className={styles.urgent}>
            <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} data-testid="urgent-check" />
            <span>
              <b>Urgent</b>
              <small>Offensive or very visible. Shows at the top for the crew.</small>
            </span>
          </label>

          <span className={styles.lbl}>Photo of the tag (recommended)</span>
          <label className={`${styles.photobtn} ${styles.reportPhoto} ${locked ? styles.locked : ""}`}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              data-testid="report-input"
              onClick={(e) => {
                if (blockIfLocked()) e.preventDefault();
              }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f && !blockIfLocked()) setReportFile(f);
              }}
            />
            {reportFile ? "Retake photo" : "Take photo of the tag"}
            <small>Helps whoever removes it find and prepare for it</small>
          </label>
          {reportPreview && (
            <div className={styles.reportPreview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={reportPreview} alt="Photo of the tag" />
              <button type="button" className={styles.linkbtn} onClick={() => setReportFile(null)}>
                Remove photo
              </button>
            </div>
          )}

          <button type="submit" className={`${styles.btn} ${styles.block}`} style={{ marginTop: 16 }} disabled={saving} data-testid="save-report">
            {saving ? "Saving..." : "Send report"}
          </button>
        </Fragment>
      ) : (
        <Fragment key="remove">
          <label className={`${styles.photobtn} ${busy ? styles.busy : ""} ${locked ? styles.locked : ""}`}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              data-testid="before-input"
              onClick={(e) => {
                if (blockIfLocked()) e.preventDefault();
              }}
              onChange={onBeforePhoto}
            />
            Take before photo
            <small>{locked ? "Fill in the details above first" : "Saves the job and starts the timer"}</small>
          </label>
          <div className={styles.hint} data-testid="detail-hint">
            {locked
              ? `Needed before the photo: ${lacking.join(", ")}.`
              : "The clock starts the moment the photo is taken. You can fix details afterwards on the job."}
          </div>

          <details className={styles.details} open={otherOpen} onToggle={(e) => setOtherOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>Already finished? Log it without the timer</summary>
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
            <button type="submit" className={`${styles.btn} ${styles.sec} ${styles.block}`} style={{ marginTop: 12 }} disabled={saving}>
              {saving ? "Saving..." : "Save completed job"}
            </button>
          </details>
        </Fragment>
      )}
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

function PhotoButton({
  text,
  sub,
  go,
  disabled,
  locked,
  onBlocked,
  onPhoto,
}: {
  text: string;
  sub: string;
  go?: boolean;
  disabled: boolean;
  /** required details are missing: the camera does not open */
  locked?: boolean;
  onBlocked?: () => void;
  onPhoto: (f: File, at: number) => void;
}) {
  return (
    <label className={`${styles.photobtn} ${go ? styles.go : ""} ${disabled ? styles.busy : ""} ${locked ? styles.locked : ""}`}>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        data-testid={go ? "after-input" : "start-input"}
        onClick={(e) => {
          if (locked) {
            e.preventDefault();
            onBlocked?.();
          }
        }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (locked) return onBlocked?.();
          onPhoto(f, Date.now());
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
  const [mins, setMins] = useState(inc.duration_min != null ? String(inc.duration_min) : "");
  const [gtype, setGtype] = useState<GraffitiType>(inc.gtype);
  const [surface, setSurface] = useState(inc.surface ?? "");
  const [chemical, setChemical] = useState(inc.chemical ?? "");
  const [busy, setBusy] = useState(false);
  const [showErr, setShowErr] = useState(false);
  // starting or finishing needs all three details (what the crew typed here counts)
  const lacking = missingDetails({ surface, chemical }, true);
  const locked = lacking.length > 0;
  function blocked(): boolean {
    if (!locked) return false;
    setShowErr(true);
    toast(detailsMessage(lacking));
    return true;
  }

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
      fd.set("surface", surface);
      fd.set("chemical", chemical);
      fd.set("notes", notes);
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
        {inc.urgent && inc.status !== "removed" && <span className={`${styles.badge} ${styles.bUrgent}`} style={{ marginLeft: 6 }}>Urgent</span>}
        <h2>{inc.address || `${inc.lat.toFixed(5)}, ${inc.lng.toFixed(5)}`}</h2>
        <div className={styles.small}>{meta}</div>
        {(inc.reported_by_name || inc.claimed_by_name || inc.removed_by_name) && (
          <div className={styles.small} data-testid="sheet-people">
            {[
              inc.reported_by_name ? `Reported by ${inc.reported_by_name}` : "",
              inc.status === "removed" && inc.removed_by_name
                ? `Removed by ${inc.removed_by_name}`
                : inc.claimed_by_name
                  ? `Taken by ${inc.claimed_by_me ? "you" : inc.claimed_by_name}`
                  : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
        {inc.description && <p>{inc.description}</p>}

        {inc.status === "in_progress" && inc.started_at && <Elapsed start={inc.started_at} className={styles.bigtimer} />}
        {inc.status === "removed" && inc.duration_min != null && (
          <div className={`${styles.bigtimer} ${styles.done}`}>{fmtDur(inc.duration_min)}</div>
        )}

        <div className={styles.photos}>
          {inc.report_photo && <PhotoFig label="As reported" name={inc.report_photo} />}
          <PhotoFig label="Before" name={inc.before_photo} />
          <PhotoFig label="After" name={inc.after_photo} />
        </div>

        {(inc.status === "reported" || inc.status === "scheduled") && (
          <div className={styles.claimBox} data-testid="claim-box">
            {!inc.claimed_by_name ? (
              <button type="button" className={`${styles.btn} ${styles.block}`} disabled={busy} data-testid="claim-btn" onClick={() => save({ claim: "me" }, undefined, "You took this one")}>
                I'll take this
              </button>
            ) : inc.claimed_by_me ? (
              <button type="button" className={`${styles.btn} ${styles.sec} ${styles.block}`} disabled={busy} data-testid="release-btn" onClick={() => save({ claim: "release" }, undefined, "Given back")}>
                You took this one. Give it back
              </button>
            ) : (
              <button type="button" className={`${styles.btn} ${styles.sec} ${styles.block}`} disabled={busy} data-testid="takeover-btn" onClick={() => save({ claim: "me" }, undefined, "You took this one")}>
                {inc.claimed_by_name} took this. Take over
              </button>
            )}
            <button
              type="button"
              className={styles.linkbtn}
              disabled={busy}
              data-testid="urgent-btn"
              onClick={() => save({ urgent: inc.urgent ? "0" : "1" }, undefined, inc.urgent ? "Urgent flag removed" : "Marked urgent")}
            >
              {inc.urgent ? "Remove urgent flag" : "Mark urgent"}
            </button>
            {!inc.report_photo && !inc.before_photo && (
              <>
                <span className={styles.lbl}>Add a photo of the tag</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  data-testid="add-report-photo"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void save({ photo_kind: "report" }, f, "Photo added");
                  }}
                />
              </>
            )}
          </div>
        )}

        {inc.status === "in_progress" && (
          <div>
            <PhotoButton
              go
              disabled={busy}
              text="Take after photo"
              sub={locked ? "Fill in the details below first" : "Finishes the job and stops the timer"}
              locked={locked}
              onBlocked={blocked}
              onPhoto={(f, at) => save({ act: "finish", photo_at: String(at) }, f, "Job finished")}
            />
            <div style={{ textAlign: "center" }}>
              <button type="button" className={styles.linkbtn} disabled={busy} onClick={() => !blocked() && save({ act: "finish" }, undefined, "Job finished")}>
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
              sub={locked ? "Fill in the details below first" : "Starts the timer"}
              locked={locked}
              onBlocked={blocked}
              onPhoto={(f, at) => save({ act: "start", photo_at: String(at) }, f, "Timer started")}
            />
            <div style={{ textAlign: "center" }}>
              <button type="button" className={styles.linkbtn} disabled={busy} onClick={() => !blocked() && save({ act: "start" }, undefined, "Timer started")}>
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

        <PickField id="gs-surface" label="What it's on" options={SURFACE_OPTIONS} value={surface} onChange={setSurface} required={inc.status !== "removed"} invalid={showErr && !surface.trim()} />
        <PickField id="gs-chem" label="Chemical used" options={CHEMICAL_OPTIONS} value={chemical} onChange={setChemical} required={inc.status !== "removed"} invalid={showErr && !chemical.trim()} />

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
