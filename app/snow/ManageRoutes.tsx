"use client";

import { useEffect, useState } from "react";
import g from "../graffiti/graffiti.module.css";
import s from "./snow.module.css";
import { apiJson } from "../graffiti/clientUtil";
import { MAX_ROUTE_BYTES, SnowRoute, SnowStop, fmtSize, searchText } from "@/lib/snow";
import { carryOverStops, errMsg, findPlace, getRouteBytes, readPdfStops } from "./pdf";

// Owner only: add a route (name, PDF, notes, pin), and edit / replace / delete existing ones.
// When a PDF is picked, each page's heading is read so the route gets a list of stops; the owner then pins
// them (Find on map looks each name up on OpenStreetMap; Tap the map or Here to place one by hand).

export type Here = { lat: number; lng: number; acc: number };
export type LatLng = { lat: number; lng: number };
export type RequestPin = (label: string, cb: (ll: LatLng) => void) => void;
type Toast = (msg: string) => void;
type PinValue = LatLng | null;

const BOZEMAN: LatLng = { lat: 45.679, lng: -111.038 };
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uploads straight to storage with the one-time link from the server, reporting progress. */
function putFile(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("cacheControl", "31536000");
    form.append("", new Blob([file], { type: "application/pdf" }), file.name || "route.pdf");
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The upload was refused (${xhr.status}). Try again.`)));
    xhr.onerror = () => reject(new Error("The upload stopped. Check your connection and try again."));
    xhr.send(form);
  });
}

async function uploadRoute(
  file: File,
  fields: { name: string; notes: string; pin: PinValue; stops: SnowStop[] },
  replaces: string | null,
  onProgress: (pct: number) => void,
): Promise<{ route: SnowRoute; routes: SnowRoute[] }> {
  if (file.type && file.type !== "application/pdf") throw new Error("Choose a PDF file.");
  if (file.size > MAX_ROUTE_BYTES) throw new Error(`That PDF is ${fmtSize(file.size)}. The limit is ${fmtSize(MAX_ROUTE_BYTES)}.`);
  const json = { "Content-Type": "application/json" };
  const start = await apiJson<{ id: string; uploadUrl: string }>("/api/snow/routes", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ name: fields.name, size: file.size, replaces }),
  });
  await putFile(start.uploadUrl, file, onProgress);
  return apiJson<{ route: SnowRoute; routes: SnowRoute[] }>(`/api/snow/routes/${start.id}`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({
      name: fields.name,
      notes: fields.notes,
      lat: fields.pin?.lat ?? null,
      lng: fields.pin?.lng ?? null,
      stops: fields.stops,
      replaces,
    }),
  });
}

/** Reads the stops from a picked file; never throws (a PDF without text just has no stops). */
async function stopsFromFile(file: File): Promise<{ title: string | null; pages: number; stops: SnowStop[] } | null> {
  try {
    return await readPdfStops(await file.arrayBuffer());
  } catch {
    return null;
  }
}

function PinPicker({
  value,
  onChange,
  here,
  requestPin,
  label,
}: {
  value: PinValue;
  onChange: (v: PinValue) => void;
  here: Here | null;
  requestPin: RequestPin;
  label: string;
}) {
  return (
    <>
      <p className={s.pinLine} data-testid="snow-pin-line">
        {value ? `Pin set at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : "No pin."}
      </p>
      <div className={s.pinBtns}>
        <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => requestPin(`Tap the map where ${label} is`, (ll) => onChange(ll))}>
          Tap the map
        </button>
        <button type="button" className={`${g.btn} ${g.sec}`} disabled={!here} onClick={() => here && onChange({ lat: here.lat, lng: here.lng })}>
          Use my location
        </button>
        {value && (
          <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => onChange(null)}>
            Remove pin
          </button>
        )}
      </div>
    </>
  );
}

/** One row per stop: its page, name, and pin. "Find all on map" fills in the unpinned ones. */
function StopsEditor({
  stops,
  onChange,
  here,
  requestPin,
  near,
  onReread,
}: {
  stops: SnowStop[];
  onChange: (next: SnowStop[]) => void;
  here: Here | null;
  requestPin: RequestPin;
  near: LatLng;
  onReread?: () => void;
}) {
  const [finding, setFinding] = useState<string | null>(null);
  const [found, setFound] = useState<Record<number, string>>({});

  // the one-by-one search adds each result to the list as it stood when the search started
  const stopsRef = { current: stops };
  const set = (page: number, patch: Partial<SnowStop>) => onChange(stops.map((x) => (x.page === page ? { ...x, ...patch } : x)));

  async function findOne(st: SnowStop): Promise<boolean> {
    const q = searchText(st.title);
    if (!q) {
      setFound((f) => ({ ...f, [st.page]: "Nothing to search for. Place it by hand." }));
      return false;
    }
    try {
      const hit = await findPlace(q, near);
      setFound((f) => ({ ...f, [st.page]: hit ? `Found: ${hit.label}. Check it on the map.` : `"${q}" not found. Place it by hand.` }));
      if (hit) {
        stopsRef.current = stopsRef.current.map((x) => (x.page === st.page ? { ...x, lat: hit.lat, lng: hit.lng } : x));
        onChange(stopsRef.current);
      }
      return !!hit;
    } catch {
      setFound((f) => ({ ...f, [st.page]: "The map search didn't answer. Try again or place it by hand." }));
      return false;
    }
  }


  async function findAll() {
    const todo = stops.filter((x) => x.lat === null);
    let hits = 0;
    for (let i = 0; i < todo.length; i++) {
      setFinding(`Finding ${i + 1} of ${todo.length}…`);
      if (await findOne(todo[i])) hits++;
      if (i < todo.length - 1) await sleep(1100); // the free map search allows one lookup a second
    }
    setFinding(null);
    setFound((f) => ({ ...f, [-1]: `Found ${hits} of ${todo.length}. Save, then check each pin on the map.` }));
  }

  if (stops.length === 0) {
    return (
      <p className={s.pinLine}>
        No stops. This PDF has no page headings to read.{" "}
        {onReread && (
          <button type="button" className={g.linkbtn} onClick={onReread}>
            Read the PDF again
          </button>
        )}
      </p>
    );
  }
  const unpinned = stops.filter((x) => x.lat === null).length;
  return (
    <div className={s.stopsEdit} data-testid="snow-stops-edit">
      <div className={s.pinBtns}>
        <button type="button" className={`${g.btn} ${g.sec}`} disabled={!!finding || unpinned === 0} onClick={() => void findAll()} data-testid="snow-find-all">
          {finding ?? (unpinned ? `Find ${unpinned} stop${unpinned === 1 ? "" : "s"} on the map` : "Every stop is pinned")}
        </button>
        {onReread && (
          <button type="button" className={`${g.btn} ${g.sec}`} disabled={!!finding} onClick={onReread}>
            Read page titles again
          </button>
        )}
      </div>
      {found[-1] && <p className={s.pinLine}>{found[-1]}</p>}
      {stops.map((st) => (
        <div key={st.page} className={s.stopEdit} data-testid="snow-stop-edit">
          <label className={g.lbl} htmlFor={`snow-stop-${st.page}`}>
            Page {st.page}
          </label>
          <input id={`snow-stop-${st.page}`} type="text" maxLength={120} value={st.title} onChange={(e) => set(st.page, { title: e.target.value })} />
          <p className={s.pinLine}>
            {st.lat !== null && st.lng !== null ? `Pinned at ${st.lat.toFixed(5)}, ${st.lng.toFixed(5)}` : "No pin"}
            {found[st.page] ? ` · ${found[st.page]}` : ""}
          </p>
          <div className={s.pinBtns}>
            <button type="button" className={`${g.btn} ${g.sec}`} disabled={!!finding} onClick={() => void findOne(st)}>
              Find on map
            </button>
            <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => requestPin(`Tap the map where ${st.title} is`, (ll) => set(st.page, ll))}>
              Tap the map
            </button>
            <button type="button" className={`${g.btn} ${g.sec}`} disabled={!here} onClick={() => here && set(st.page, { lat: here.lat, lng: here.lng })}>
              Here
            </button>
            {st.lat !== null && (
              <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => set(st.page, { lat: null, lng: null })}>
                Clear
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ManageRoutes({
  routes,
  here,
  toast,
  onList,
  requestPin,
  onUploaded,
}: {
  routes: SnowRoute[];
  here: Here | null;
  toast: Toast;
  onList: (list: SnowRoute[]) => void;
  requestPin: RequestPin;
  onUploaded: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState<PinValue>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stops, setStops] = useState<SnowStop[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(routes.length === 0);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  async function pick(f: File | null) {
    setFile(f);
    setStops([]);
    setReading(null);
    if (!f) return;
    setReading("Reading the pages…");
    const info = await stopsFromFile(f);
    if (!info) {
      setReading("Couldn't read the pages. You can still add it; it just won't have stops.");
      return;
    }
    setStops(info.stops);
    setName((n) => (n.trim() ? n : (info.title ?? "").slice(0, 80)));
    setReading(
      info.stops.length
        ? `${info.pages} page${info.pages === 1 ? "" : "s"}, ${info.stops.length} stop${info.stops.length === 1 ? "" : "s"}: ${info.stops.map((x) => x.title).join(" · ")}`
        : `${info.pages} page${info.pages === 1 ? "" : "s"}, no page headings found (it will show as one route with no stops).`,
    );
  }

  async function add() {
    setErr(null);
    if (!name.trim()) return setErr("Give the route a name.");
    if (!file) return setErr("Choose the route PDF.");
    setPct(0);
    try {
      const d = await uploadRoute(file, { name, notes, pin, stops }, null, setPct);
      onList(d.routes);
      onUploaded(d.route.id);
      setJustAdded(d.route.id);
      setName("");
      setNotes("");
      setPin(null);
      setFile(null);
      setStops([]);
      setReading(null);
      setFileKey((k) => k + 1);
      toast(d.route.stops.length > 1 ? `${d.route.name} added. Pin its stops below.` : `${d.route.name} added.`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setPct(null);
    }
  }

  return (
    <details className={s.manage} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="snow-manage">
      <summary>Manage routes (only you see this)</summary>
      <div className={s.manageBody}>
        <div className={s.box}>
          <h4>Add a route</h4>
          <label className={g.lbl} htmlFor="snow-new-file">
            Route PDF<span className={g.req}> *</span>
          </label>
          <input
            key={fileKey}
            id="snow-new-file"
            className={s.fileIn}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            data-testid="snow-new-file"
          />
          {file && (
            <p className={s.pinLine} data-testid="snow-read">
              {fmtSize(file.size)}
              {reading ? ` · ${reading}` : ""}
            </p>
          )}
          <label className={g.lbl} htmlFor="snow-new-name">
            Name<span className={g.req}> *</span>
          </label>
          <input id="snow-new-name" type="text" maxLength={80} placeholder="e.g. Trailered SR Mag route" value={name} onChange={(e) => setName(e.target.value)} />
          <label className={g.lbl} htmlFor="snow-new-notes">
            Notes for the crew (optional)
          </label>
          <textarea id="snow-new-notes" rows={2} maxLength={500} placeholder="e.g. Sidewalks by 8am." value={notes} onChange={(e) => setNotes(e.target.value)} />
          <span className={g.lbl}>Route map pin (optional)</span>
          <p className={s.pinLine}>Only needed for a route without stops. With stops, pin the stops after adding it.</p>
          <PinPicker value={pin} onChange={setPin} here={here} requestPin={requestPin} label={name.trim() || "this route"} />
          {pct !== null && (
            <div className={s.progress} aria-label={`Uploading ${pct}%`}>
              <div style={{ width: `${pct}%` }} />
            </div>
          )}
          {err && <p className={s.formErr}>{err}</p>}
          <button
            type="button"
            className={`${g.btn} ${g.block}`}
            style={{ marginTop: 12 }}
            disabled={pct !== null || reading === "Reading the pages…"}
            onClick={() => void add()}
            data-testid="snow-add"
          >
            {pct !== null ? (pct < 100 ? `Uploading… ${pct}%` : "Checking the file…") : "Add route"}
          </button>
        </div>

        {routes.map((r) => (
          <RouteRow key={r.id} route={r} here={here} toast={toast} onList={onList} requestPin={requestPin} startEditing={r.id === justAdded && r.stops.length > 1} />
        ))}
      </div>
    </details>
  );
}

function RouteRow({
  route,
  here,
  toast,
  onList,
  requestPin,
  startEditing,
}: {
  route: SnowRoute;
  here: Here | null;
  toast: Toast;
  onList: (list: SnowRoute[]) => void;
  requestPin: RequestPin;
  startEditing: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [name, setName] = useState(route.name);
  const [notes, setNotes] = useState(route.notes ?? "");
  const [pin, setPin] = useState<PinValue>(route.lat !== null && route.lng !== null ? { lat: route.lat, lng: route.lng } : null);
  const [stops, setStops] = useState<SnowStop[]>(route.stops);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setName(route.name);
    setNotes(route.notes ?? "");
    setPin(route.lat !== null && route.lng !== null ? { lat: route.lat, lng: route.lng } : null);
    setStops(route.stops);
  }, [route, editing]);

  const pinnedStops = route.stops.filter((x) => x.lat !== null).length;
  const near: LatLng =
    stops.find((x) => x.lat !== null && x.lng !== null) ?? (route.lat !== null && route.lng !== null ? { lat: route.lat, lng: route.lng } : null) ?? here ?? BOZEMAN;

  async function save() {
    setErr(null);
    if (stops.some((x) => !x.title.trim())) return setErr("Every stop needs a name.");
    setBusy("Saving…");
    try {
      const d = await apiJson<{ routes: SnowRoute[] }>(`/api/snow/routes/${route.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, notes, lat: pin?.lat ?? null, lng: pin?.lng ?? null, stops }),
      });
      onList(d.routes);
      setEditing(false);
      toast("Saved.");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function reread() {
    setErr(null);
    setBusy("Reading the pages…");
    try {
      const { bytes } = await getRouteBytes(route.id);
      const info = await readPdfStops(bytes);
      setStops(carryOverStops(info.stops, stops));
      toast(`Read ${info.stops.length} stop${info.stops.length === 1 ? "" : "s"}. Save to keep them.`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function replace(file: File) {
    setErr(null);
    try {
      setBusy("Reading the pages…");
      const info = await stopsFromFile(file);
      const nextStops = info ? carryOverStops(info.stops, route.stops) : [];
      setBusy("Uploading… 0%");
      const d = await uploadRoute(
        file,
        { name: route.name, notes: route.notes ?? "", pin, stops: nextStops },
        route.id,
        (p) => setBusy(p < 100 ? `Uploading… ${p}%` : "Checking the file…"),
      );
      onList(d.routes);
      const kept = nextStops.filter((x) => x.lat !== null).length;
      toast(`${route.name}: new PDF is live${nextStops.length ? ` (${kept} of ${nextStops.length} stops kept their pins)` : ""}.`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirmDel) {
      setConfirmDel(true);
      window.setTimeout(() => setConfirmDel(false), 4000);
      return;
    }
    setErr(null);
    setBusy("Deleting…");
    try {
      const d = await apiJson<{ routes: SnowRoute[] }>(`/api/snow/routes/${route.id}`, { method: "DELETE" });
      onList(d.routes);
      toast(`${route.name} deleted.`);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(null);
    }
  }

  return (
    <div className={s.box} data-testid="snow-row">
      {editing ? (
        <>
          <label className={g.lbl} htmlFor={`snow-name-${route.id}`}>
            Name
          </label>
          <input id={`snow-name-${route.id}`} type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <label className={g.lbl} htmlFor={`snow-notes-${route.id}`}>
            Notes for the crew
          </label>
          <textarea id={`snow-notes-${route.id}`} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <span className={g.lbl}>Stops ({stops.length})</span>
          <p className={s.pinLine}>A pinned stop lets the crew page open its page automatically when a phone gets within about 500 ft.</p>
          <StopsEditor stops={stops} onChange={setStops} here={here} requestPin={requestPin} near={near} onReread={() => void reread()} />
          <span className={g.lbl}>Route map pin</span>
          <PinPicker value={pin} onChange={setPin} here={here} requestPin={requestPin} label={name.trim() || route.name} />
          {err && <p className={s.formErr}>{err}</p>}
          <div className={s.actions}>
            <button type="button" className={g.btn} disabled={!!busy} onClick={() => void save()} data-testid="snow-save">
              {busy ?? "Save"}
            </button>
            <button type="button" className={`${g.btn} ${g.sec}`} disabled={!!busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <h4>{route.name}</h4>
          <p className={s.pinLine}>
            {fmtSize(route.size)} · uploaded {fmtDay(route.uploaded_at)} ·{" "}
            {route.stops.length ? `${route.stops.length} stops, ${pinnedStops} pinned` : route.lat !== null ? "pinned on map" : "no pin"}
          </p>
          {err && <p className={s.formErr}>{err}</p>}
          <div className={s.actions}>
            <button type="button" className={`${g.btn} ${g.sec}`} disabled={!!busy} onClick={() => setEditing(true)} data-testid="snow-edit">
              Edit{route.stops.length ? " / pin stops" : ""}
            </button>
            <label className={`${g.btn} ${g.sec} ${s.replaceLbl}`} aria-disabled={!!busy}>
              {busy && busy !== "Deleting…" ? busy : "Replace PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void replace(f);
                }}
              />
            </label>
            <button type="button" className={`${g.btn} ${g.danger}`} disabled={!!busy} onClick={() => void remove()} data-testid="snow-delete">
              {busy === "Deleting…" ? busy : confirmDel ? "Tap again to delete" : "Delete"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
