"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import styles from "../graffiti/graffiti.module.css";
import extra from "./jobs.module.css";
import { apiJson, lookupPlace, shrinkPhoto } from "../graffiti/clientUtil";
import { Elapsed, PhotoButton, errMsg, fmtDate, fmtTime } from "../graffiti/GraffitiTab";
import { CITIES, CITY_NAMES, City, MAX_MINUTES, autoCity, fmtDur, isCity, money } from "@/lib/graffiti";
import {
  BILL_MODES,
  BILL_MODE_LABEL,
  BillMode,
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  JOB_TYPE_LABEL,
  JOB_TYPE_ONE,
  Job,
  JobStatus,
  JobType,
  MAX_MATERIALS,
} from "@/lib/jobs";

// One tab for work orders, lawn care or other jobs. The three tabs are this same component with a different `jtype`.
// Photos, timer and list behave like the graffiti tracker; billing (price / materials) is only shown to people who may see prices.

const BADGE: Record<JobStatus, string> = {
  open: styles.bScheduled,
  in_progress: styles.bInProgress,
  done: styles.bRemoved,
};

const jobPhoto = (name: string | null | undefined) => (name ? `/api/jobs/photo/${encodeURIComponent(name)}` : null);

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

type MatRow = { desc: string; amount: string };
const toRows = (job: Job | null): MatRow[] => (job?.materials ?? []).map((m) => ({ desc: m.desc, amount: (m.cents / 100).toFixed(2) }));
const rowsJson = (rows: MatRow[]) => JSON.stringify(rows.filter((r) => r.desc.trim() || r.amount.trim()));

function CityBoxes({ id, value, onChange, invalid }: { id: string; value: City | ""; onChange: (c: City) => void; invalid?: boolean }) {
  return (
    <div className={styles.pick}>
      <span className={styles.lbl} id={`${id}-lbl`}>
        City<span className={styles.req}> *</span>
      </span>
      <div className={`${styles.opts} ${invalid ? styles.invalid : ""}`} role="radiogroup" aria-labelledby={`${id}-lbl`} aria-required="true" id={id}>
        {CITIES.map((c) => (
          <label key={c} className={styles.opt}>
            <input type="radio" name={id} value={c} checked={value === c} onChange={() => onChange(c)} />
            <span>{CITY_NAMES[c]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function BillingFields({
  idp,
  mode,
  setMode,
  price,
  setPrice,
  rows,
  setRows,
}: {
  idp: string;
  mode: BillMode;
  setMode: (m: BillMode) => void;
  price: string;
  setPrice: (v: string) => void;
  rows: MatRow[];
  setRows: (r: MatRow[]) => void;
}) {
  return (
    <div data-testid="billing-fields">
      <div className={styles.pick}>
        <span className={styles.lbl} id={`${idp}-bm-lbl`}>
          How it is billed
        </span>
        <div className={styles.opts} role="radiogroup" aria-labelledby={`${idp}-bm-lbl`} id={`${idp}-bm`}>
          {BILL_MODES.map((m) => (
            <label key={m} className={styles.opt}>
              <input type="radio" name={`${idp}-bm`} value={m} checked={mode === m} onChange={() => setMode(m)} />
              <span>{BILL_MODE_LABEL[m]}</span>
            </label>
          ))}
        </div>
      </div>
      {mode === "flat" && (
        <>
          <label className={styles.lbl} htmlFor={`${idp}-price`}>
            Flat price ($)
          </label>
          <input id={`${idp}-price`} type="text" inputMode="decimal" placeholder="e.g. 250" maxLength={12} value={price} onChange={(e) => setPrice(e.target.value)} />
        </>
      )}
      {mode === "hourly_materials" && (
        <div data-testid="materials" style={{ marginTop: 10 }}>
          <span className={styles.lbl}>Materials</span>
          {rows.map((r, i) => (
            <div key={i} className={styles.row} style={{ marginBottom: 6 }}>
              <input
                type="text"
                aria-label={`Material ${i + 1} name`}
                placeholder="What (mulch, sod, paint...)"
                maxLength={80}
                value={r.desc}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))}
              />
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Material ${i + 1} amount`}
                placeholder="$"
                maxLength={12}
                style={{ maxWidth: 96 }}
                value={r.amount}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
              />
              <button type="button" className={styles.linkbtn} aria-label={`Remove material ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          {rows.length < MAX_MATERIALS && (
            <button type="button" className={`${styles.btn} ${styles.sec}`} data-testid="add-material" onClick={() => setRows([...rows, { desc: "", amount: "" }])}>
              + Add material
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ======================================================================
   Main tab
   ====================================================================== */

export default function JobsTab({ jtype, isOwner }: { jtype: JobType; isOwner: boolean }) {
  const label = JOB_TYPE_LABEL[jtype];
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [canBill, setCanBill] = useState(false);
  const [view, setView] = useState<"list" | "add">("list");
  const [openId, setOpenId] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const [fStatus, setFStatus] = useState("");
  const [fCity, setFCity] = useState("");
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
        const data = await apiJson<{ jobs: Job[]; truncated: boolean; canBill: boolean }>(`/api/jobs/${jtype}`);
        setJobs(data.jobs);
        setTruncated(data.truncated);
        setCanBill(data.canBill === true);
      } catch (e) {
        if (!quiet) toast(errMsg(e));
      }
      setLoaded(true);
    },
    [jtype, toast],
  );

  // first load, then keep fresh when the phone wakes up or every 15 seconds (so the crew sees each other's work)
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

  const upsert = useCallback((job: Job) => {
    setJobs((prev) => (prev.some((x) => x.id === job.id) ? prev.map((x) => (x.id === job.id ? job : x)) : [job, ...prev]));
  }, []);

  const stats = useMemo(() => {
    const open = jobs.filter((j) => j.status === "open").length;
    const prog = jobs.filter((j) => j.status === "in_progress").length;
    const done = jobs.filter((j) => j.status === "done").length;
    const ds = jobs.filter((j) => j.status === "done" && j.duration_min != null).map((j) => j.duration_min as number);
    const avg = ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : null;
    return { open, prog, done, avg };
  }, [jobs]);

  const running = useMemo(() => jobs.filter((j) => j.status === "in_progress" && j.started_at), [jobs]);

  const rows = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return jobs.filter(
      (j) =>
        (!fStatus || j.status === fStatus) &&
        (!fCity || j.city === fCity) &&
        (!q || `${j.title} ${j.wo_number ?? ""} ${j.address ?? ""} ${j.description ?? ""} ${j.notes ?? ""} ${j.created_by_name ?? ""}`.toLowerCase().includes(q)),
    );
  }, [jobs, fStatus, fCity, fSearch]);

  const opened = openId !== null ? jobs.find((j) => j.id === openId) ?? null : null;

  return (
    <div className={styles.root} data-testid={`jobs-${jtype}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>{label}</h2>
        {canBill && (
          <a className={styles.headLink} href={`/jobs/${jtype}/invoice`} data-testid="invoice-link">
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
          <span>Done</span>
        </div>
        <div className={styles.chip}>
          <b>{stats.avg == null ? "-" : fmtDur(stats.avg)}</b>
          <span>Avg time</span>
        </div>
      </div>

      {running.map((j) => (
        <button key={j.id} type="button" className={styles.active} onClick={() => setOpenId(j.id)}>
          <span>
            <b>Job in progress</b>
            <span className={styles.small}>{j.title + (j.address ? " · " + j.address : "")}</span>
          </span>
          <Elapsed start={j.started_at as string} className={styles.timer} />
        </button>
      ))}

      <nav className={styles.subnav} aria-label={`${label} views`}>
        {(
          [
            ["list", "List"],
            ["add", "+ Log new"],
          ] as const
        ).map(([v, text]) => (
          <button key={v} type="button" className={view === v ? styles.on : undefined} aria-pressed={view === v} onClick={() => setView(v)}>
            {text}
          </button>
        ))}
      </nav>

      <section hidden={view !== "list"} aria-label={`${label} list`}>
        <div className={styles.filters}>
          <select aria-label="Filter by status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">All statuses</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select aria-label="Filter by city" value={fCity} onChange={(e) => setFCity(e.target.value)}>
            <option value="">Both cities</option>
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {CITY_NAMES[c]}
              </option>
            ))}
          </select>
          <input type="text" aria-label="Search" placeholder="Search title / WO # / address" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        </div>
        {!loaded ? (
          <div className={styles.empty}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>{jobs.length ? "Nothing matches." : `No ${label.toLowerCase()} logged yet. Tap + Log new.`}</div>
        ) : (
          rows.map((j) => {
            const src = jobPhoto(j.after_photo || j.before_photo);
            return (
              <button key={j.id} type="button" className={styles.card} data-testid="job-card" onClick={() => setOpenId(j.id)}>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.thumb} src={src} alt="" loading="lazy" />
                ) : (
                  <span className={styles.thumb} />
                )}
                <div>
                  <span className={`${styles.badge} ${BADGE[j.status]}`}>{JOB_STATUS_LABEL[j.status]}</span>
                  <div className={styles.cardTitle}>{(j.wo_number ? `#${j.wo_number} · ` : "") + j.title}</div>
                  <div className={styles.cardMeta}>
                    {`${CITY_NAMES[j.city]} · ${fmtDate(j.done_at || j.started_at || j.created_at)}` + (j.duration_min != null ? ` · ${fmtDur(j.duration_min)}` : "")}
                  </div>
                  {(j.created_by_name || j.done_by_name) && (
                    <div className={styles.cardMeta}>
                      {j.status === "done" && j.done_by_name ? `Done by ${j.done_by_name}` : j.created_by_name ? `Logged by ${j.created_by_name}` : ""}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
        {truncated && <div className={styles.note}>Showing the newest 900 jobs.</div>}
      </section>

      <section hidden={view !== "add"} aria-label={`Log a new ${JOB_TYPE_ONE[jtype]}`}>
        <AddForm
          jtype={jtype}
          canBill={canBill}
          toast={toast}
          onCreated={(job) => {
            upsert(job);
            setView("list");
          }}
        />
      </section>

      {opened && (
        <JobSheet
          key={opened.id}
          job={opened}
          jtype={jtype}
          canBill={canBill}
          canDelete={isOwner || opened.mine === true}
          toast={toast}
          onClose={() => setOpenId(null)}
          onSaved={upsert}
          onDeleted={(id) => setJobs((prev) => prev.filter((x) => x.id !== id))}
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
   Add form
   ====================================================================== */

function AddForm({ jtype, canBill, toast, onCreated }: { jtype: JobType; canBill: boolean; toast: Toast; onCreated: (job: Job) => void }) {
  const cityKey = "jobs_city";
  const [title, setTitle] = useState("");
  const [wo, setWo] = useState("");
  const [city, setCity] = useState<City | "">("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [mode, setMode] = useState<BillMode>("hourly");
  const [price, setPrice] = useState("");
  const [mats, setMats] = useState<MatRow[]>([]);
  const [minutes, setMinutes] = useState("");
  const [hint, setHint] = useState("");
  const [showErr, setShowErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  // the city the crew used last is the likely one again
  useEffect(() => {
    const last = readStore(cityKey);
    if (isCity(last)) setCity((c) => c || last);
  }, []);

  const lacking = [!title.trim() ? "the job title" : "", !city ? "the city" : ""].filter(Boolean);
  const locked = lacking.length > 0;
  function blockIfLocked(): boolean {
    if (!locked) return false;
    setShowErr(true);
    toast(`Fill in ${lacking.join(" and ")} first.`);
    return true;
  }

  function useGps() {
    if (!navigator.geolocation) return setHint("GPS is not available here. Type the address.");
    setGpsBusy(true);
    setHint("Getting your GPS location...");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const { latitude: lat, longitude: lng } = p.coords;
        setPin({ lat, lng });
        setCity(autoCity(lat, lng));
        setHint("Location saved. Change the city if the job is for the other one.");
        setGpsBusy(false);
        const place = await lookupPlace(lat, lng);
        if (place) setAddress((a) => (a.trim() ? a : place));
      },
      () => {
        setGpsBusy(false);
        setHint("No GPS. Allow location access, or just type the address.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  function resetForm() {
    setTitle("");
    setWo("");
    setAddress("");
    setDescription("");
    setPin(null);
    setMode("hourly");
    setPrice("");
    setMats([]);
    setMinutes("");
    setHint("");
    setShowErr(false);
  }

  async function create(kind: "start" | "open" | "done", photo?: File, at?: number) {
    if (busy || blockIfLocked()) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("mode", kind);
      fd.set("title", title);
      fd.set("wo_number", wo);
      fd.set("city", city);
      fd.set("address", address);
      fd.set("description", description);
      if (pin) {
        fd.set("lat", String(pin.lat));
        fd.set("lng", String(pin.lng));
      }
      if (canBill) {
        fd.set("bill_mode", mode);
        if (mode === "flat") fd.set("price", price);
        if (mode === "hourly_materials") fd.set("materials", rowsJson(mats));
      }
      if (kind === "done") fd.set("duration_min", minutes);
      if (photo) {
        fd.set("photo_at", String(at ?? Date.now()));
        fd.set("photo", await shrinkPhoto(photo), "before.jpg");
      }
      const { job } = await apiJson<{ job: Job }>(`/api/jobs/${jtype}`, { method: "POST", body: fd });
      writeStore(cityKey, city);
      resetForm();
      onCreated(job);
      toast(kind === "start" ? "Timer started at the photo time" : kind === "done" ? "Saved" : "Logged");
    } catch (e) {
      toast(`Not saved: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    void create("open");
  }

  return (
    <form onSubmit={onSubmit} noValidate data-testid="job-form">
      <label className={styles.lbl} htmlFor={`jt-title-${jtype}`}>
        Job title<span className={styles.req}> *</span>
      </label>
      <input
        id={`jt-title-${jtype}`}
        type="text"
        maxLength={120}
        placeholder={jtype === "lawn" ? "e.g. Mow City Hall lawn" : jtype === "workorders" ? "e.g. Replace park bench slats" : "What is the job?"}
        value={title}
        aria-invalid={(showErr && !title.trim()) || undefined}
        className={showErr && !title.trim() ? extra.blank : undefined}
        onChange={(e) => setTitle(e.target.value)}
      />

      <label className={styles.lbl} htmlFor={`jt-wo-${jtype}`}>
        {jtype === "workorders" ? "Work order #" : "Work order # (if there is one)"}
      </label>
      <input id={`jt-wo-${jtype}`} type="text" maxLength={60} placeholder="e.g. 24-1187" value={wo} onChange={(e) => setWo(e.target.value)} />

      <div className={styles.picks}>
        <CityBoxes id={`jt-city-${jtype}`} value={city} onChange={setCity} invalid={showErr && !city} />
      </div>

      <label className={styles.lbl} htmlFor={`jt-addr-${jtype}`}>
        Location / address
      </label>
      <div className={styles.loc}>
        <input id={`jt-addr-${jtype}`} type="text" maxLength={255} placeholder="Street / park / intersection" value={address} onChange={(e) => setAddress(e.target.value)} />
        <button type="button" className={`${styles.btn} ${styles.sec}`} disabled={gpsBusy} onClick={useGps} data-testid="use-gps">
          {gpsBusy ? "..." : "Use GPS"}
        </button>
      </div>
      {hint && <div className={styles.hint}>{hint}</div>}

      <label className={styles.lbl} htmlFor={`jt-desc-${jtype}`}>
        Instructions / notes (optional)
      </label>
      <textarea id={`jt-desc-${jtype}`} maxLength={2000} placeholder="What needs doing, who to call, access..." value={description} onChange={(e) => setDescription(e.target.value)} />

      {canBill && <BillingFields idp={`jt-${jtype}`} mode={mode} setMode={setMode} price={price} setPrice={setPrice} rows={mats} setRows={setMats} />}

      <PhotoButton
        disabled={busy}
        text="Take before photo"
        sub={locked ? "Fill in the title and city first" : "Saves the job and starts the timer"}
        locked={locked}
        onBlocked={blockIfLocked}
        onPhoto={(f, at) => void create("start", f, at)}
      />
      <div className={styles.hint} data-testid="detail-hint">
        {locked ? `Needed first: ${lacking.join(", ")}.` : "The clock starts the moment the photo is taken. You can fix details afterwards on the job."}
      </div>

      <button type="submit" className={`${styles.btn} ${styles.sec} ${styles.block}`} style={{ marginTop: 12 }} disabled={busy} data-testid="save-open">
        {busy ? "Saving..." : "Log it without starting"}
      </button>

      <details className={styles.details}>
        <summary>Already finished? Log it without the timer</summary>
        <label className={styles.lbl} htmlFor={`jt-min-${jtype}`}>
          Minutes it took
        </label>
        <input id={`jt-min-${jtype}`} type="number" min={0} max={MAX_MINUTES} inputMode="numeric" placeholder="e.g. 45" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <button type="button" className={`${styles.btn} ${styles.sec} ${styles.block}`} style={{ marginTop: 12 }} disabled={busy} data-testid="save-done" onClick={() => void create("done")}>
          {busy ? "Saving..." : "Save completed job"}
        </button>
      </details>
    </form>
  );
}

/* ======================================================================
   Job detail sheet
   ====================================================================== */

function PhotoFig({ label, name }: { label: string; name: string | null }) {
  const u = jobPhoto(name);
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

function JobSheet({
  job,
  jtype,
  canBill,
  canDelete,
  toast,
  onClose,
  onSaved,
  onDeleted,
}: {
  job: Job;
  jtype: JobType;
  canBill: boolean;
  canDelete: boolean;
  toast: Toast;
  onClose: () => void;
  onSaved: (job: Job) => void;
  onDeleted: (id: number) => void;
}) {
  const [title, setTitle] = useState(job.title);
  const [wo, setWo] = useState(job.wo_number ?? "");
  const [city, setCity] = useState<City>(job.city);
  const [addr, setAddr] = useState(job.address ?? "");
  const [notes, setNotes] = useState(job.notes ?? "");
  const [mins, setMins] = useState(job.duration_min != null ? String(job.duration_min) : "");
  const [mode, setMode] = useState<BillMode>(job.bill_mode);
  const [price, setPrice] = useState(job.price_cents != null ? (job.price_cents / 100).toFixed(2) : "");
  const [mats, setMats] = useState<MatRow[]>(toRows(job));
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
      fd.set("title", title);
      fd.set("wo_number", wo);
      fd.set("city", city);
      fd.set("address", addr);
      fd.set("notes", notes);
      fd.set("duration_min", mins);
      if (canBill) {
        fd.set("bill_mode", mode);
        if (mode === "flat") fd.set("price", price);
        if (mode === "hourly_materials") fd.set("materials", rowsJson(mats));
      }
      for (const [k, v] of Object.entries(extra)) fd.set(k, v);
      if (photo) fd.set("photo", await shrinkPhoto(photo), "photo.jpg");
      const { job: saved } = await apiJson<{ job: Job }>(`/api/jobs/${jtype}/${job.id}`, { method: "PATCH", body: fd });
      onSaved(saved);
      toast(message);
      onClose();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this job and its photos? This cannot be undone.")) return;
    setBusy(true);
    try {
      await apiJson<{ ok: true }>(`/api/jobs/${jtype}/${job.id}`, { method: "DELETE" });
      onDeleted(job.id);
      toast("Deleted");
      onClose();
    } catch (e) {
      toast(errMsg(e));
      setBusy(false);
    }
  }

  const meta =
    `${CITY_NAMES[job.city]} · logged ${fmtDate(job.created_at)}` +
    (job.started_at ? ` · started ${fmtTime(job.started_at)}` : "") +
    (job.finished_at ? ` · finished ${fmtTime(job.finished_at)}` : "");
  const nav = job.lat != null && job.lng != null ? `${job.lat},${job.lng}` : job.address ? encodeURIComponent(`${job.address}, ${CITY_NAMES[job.city]}, MT`) : null;

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Job details">
        <span className={`${styles.badge} ${BADGE[job.status]}`}>{JOB_STATUS_LABEL[job.status]}</span>
        <h2>{(job.wo_number ? `#${job.wo_number} · ` : "") + job.title}</h2>
        <div className={styles.small}>{meta}</div>
        {(job.created_by_name || job.done_by_name) && (
          <div className={styles.small} data-testid="sheet-people">
            {[job.created_by_name ? `Logged by ${job.created_by_name}` : "", job.status === "done" && job.done_by_name ? `Done by ${job.done_by_name}` : ""].filter(Boolean).join(" · ")}
          </div>
        )}
        {job.description && <p>{job.description}</p>}

        {job.status === "in_progress" && job.started_at && <Elapsed start={job.started_at} className={styles.bigtimer} />}
        {job.status === "done" && job.duration_min != null && <div className={`${styles.bigtimer} ${styles.done}`}>{fmtDur(job.duration_min)}</div>}

        <div className={styles.photos}>
          <PhotoFig label="Before" name={job.before_photo} />
          <PhotoFig label="After" name={job.after_photo} />
        </div>

        {job.status === "in_progress" && (
          <div>
            <PhotoButton go disabled={busy} text="Take after photo" sub="Finishes the job and stops the timer" onPhoto={(f, at) => save({ act: "finish", photo_at: String(at) }, f, "Job finished")} />
            <div style={{ textAlign: "center" }}>
              <button type="button" className={styles.linkbtn} disabled={busy} onClick={() => save({ act: "finish" }, undefined, "Job finished")}>
                Finish without a photo
              </button>
            </div>
          </div>
        )}
        {job.status === "open" && (
          <div>
            <PhotoButton disabled={busy} text="Take before photo" sub="Starts the timer" onPhoto={(f, at) => save({ act: "start", photo_at: String(at) }, f, "Timer started")} />
            <div style={{ textAlign: "center" }}>
              <button type="button" className={styles.linkbtn} disabled={busy} onClick={() => save({ act: "start" }, undefined, "Timer started")}>
                Start timer without a photo
              </button>
            </div>
          </div>
        )}
        {job.status === "done" && (
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
        {job.status !== "done" && !job.before_photo && job.status === "in_progress" && (
          <>
            <span className={styles.lbl}>Add a before photo</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              data-testid="add-before-photo"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void save({ photo_kind: "before" }, f, "Photo added");
              }}
            />
          </>
        )}

        <span className={styles.lbl}>Status</span>
        <div className={styles.seg}>
          {JOB_STATUSES.map((s) => (
            <button key={s} type="button" disabled={busy} className={`${styles.btn} ${styles.sec} ${job.status === s ? styles.cur : ""}`}
              onClick={() => {
                if (s === job.status) return;
                // a finished job is only reopened on purpose (a mis-tap here used to re-time the job)
                if (
                  job.status === "done" &&
                  !window.confirm(
                    s === "in_progress"
                      ? "This job is done. Reopen it as In progress? Its recorded time stays as it is unless you take a new after photo."
                      : `This job is done. Move it back to ${JOB_STATUS_LABEL[s]}? This clears its start and finish times.`,
                  )
                )
                  return;
                void save({ status: s });
              }}
            >
              {JOB_STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <label className={styles.lbl} htmlFor="js-min">
          Time on site (minutes)
        </label>
        <input
          id="js-min"
          type="number"
          min={0}
          max={MAX_MINUTES}
          inputMode="numeric"
          placeholder={job.status === "in_progress" ? "auto from the photos" : "minutes"}
          value={mins}
          onChange={(e) => setMins(e.target.value)}
        />
        <div className={styles.hint}>Set automatically from the before and after photo times. Type a number to override.</div>

        <label className={styles.lbl} htmlFor="js-title">
          Job title
        </label>
        <input id="js-title" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />

        <label className={styles.lbl} htmlFor="js-wo">
          Work order #
        </label>
        <input id="js-wo" type="text" maxLength={60} value={wo} onChange={(e) => setWo(e.target.value)} />

        <div className={styles.picks}>
          <CityBoxes id="js-city" value={city} onChange={setCity} />
        </div>

        <label className={styles.lbl} htmlFor="js-addr">
          Location / address
        </label>
        <input id="js-addr" type="text" maxLength={255} placeholder="Street / park / intersection" value={addr} onChange={(e) => setAddr(e.target.value)} />

        <label className={styles.lbl} htmlFor="js-notes">
          Notes
        </label>
        <textarea id="js-notes" maxLength={2000} placeholder="Crew notes, follow-up needed..." value={notes} onChange={(e) => setNotes(e.target.value)} />

        {canBill && <BillingFields idp="js" mode={mode} setMode={setMode} price={price} setPrice={setPrice} rows={mats} setRows={setMats} />}

        <div className={styles.row} style={{ marginTop: 16 }}>
          <button type="button" className={styles.btn} disabled={busy} data-testid="save-changes" onClick={() => save()}>
            Save changes
          </button>
          <button type="button" className={`${styles.btn} ${styles.sec}`} onClick={onClose}>
            Close
          </button>
        </div>
        {nav && (
          <p>
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${nav}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              Navigate here
            </a>
          </p>
        )}
        {canDelete && (
          <button type="button" className={`${styles.btn} ${styles.danger} ${styles.block}`} disabled={busy} onClick={remove}>
            Delete job
          </button>
        )}
        {job.status === "done" && canBill && (
          <div className={styles.hint} data-testid="bill-summary">
            {job.bill_mode === "flat"
              ? job.price_cents != null
                ? `Billed as a flat ${money(job.price_cents)}.`
                : "Flat price not set yet."
              : job.bill_mode === "hourly_materials"
                ? `Billed hourly + ${money(job.materials.reduce((n, m) => n + m.cents, 0))} materials.`
                : "Billed hourly."}
          </div>
        )}
      </div>
    </div>
  );
}
