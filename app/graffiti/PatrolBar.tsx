"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "./clientUtil";
import { KEEP_DAYS, MAX_ACCURACY_M, PatrolPoint, RECORD_EVERY_M, meters } from "@/lib/patrol";

// "Patrolling" switch for crews who drive around looking for graffiti.
// While it is on, the phone records a point every ~80 m driven and keeps the screen awake (so the browser keeps getting GPS).
// Nothing is recorded while it is off. Points are queued on the phone and uploaded every 30 seconds, so a dead zone loses nothing.

const STATE_KEY = "patrol_state";
const QUEUE_KEY = "patrol_queue";
const MAX_HOURS = 10;
const FLUSH_MS = 30_000;

type State = { session: string; startedAt: number; meters: number };
type WakeLock = { release: () => Promise<void>; addEventListener: (t: "release", f: () => void) => void };

const read = <T,>(k: string): T | null => {
  try {
    const v = window.localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: keep going in memory */
  }
};
const newSession = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const miles = (m: number) => (m / 1609.34).toFixed(1);
const clock = (ms: number) => {
  const min = Math.floor(ms / 60_000);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
};

const btn = (bg: string, fg = "#fff"): React.CSSProperties => ({
  font: "inherit",
  fontWeight: 700,
  fontSize: 16,
  minHeight: 48,
  padding: "10px 16px",
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
  background: bg,
  color: fg,
});

export default function PatrolBar() {
  const [state, setState] = useState<State | null>(null);
  const [resume, setResume] = useState<State | null>(null);
  const [gps, setGps] = useState<"waiting" | "ok" | "weak" | "denied" | "error">("waiting");
  const [lock, setLock] = useState<"on" | "off" | "unsupported">("off");
  const [hidden, setHidden] = useState(false);
  const [pending, setPending] = useState(0);
  const [, tick] = useState(0);

  const stateRef = useRef<State | null>(null);
  const queue = useRef<PatrolPoint[]>([]);
  const last = useRef<PatrolPoint | null>(null);
  const watchId = useRef<number | null>(null);
  const wake = useRef<WakeLock | null>(null);
  const sending = useRef(false);

  const save = () => {
    write(STATE_KEY, stateRef.current);
    write(QUEUE_KEY, queue.current.length ? { session: stateRef.current?.session ?? null, points: queue.current } : null);
    setPending(queue.current.length);
  };

  const flush = useCallback(async (session: string | undefined) => {
    if (sending.current || !session || queue.current.length === 0 || !navigator.onLine) return;
    sending.current = true;
    const batch = queue.current.slice(0, 500);
    try {
      await apiJson("/api/graffiti/patrol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session, points: batch }) });
      queue.current = queue.current.slice(batch.length);
      write(QUEUE_KEY, queue.current.length ? { session, points: queue.current } : null);
      setPending(queue.current.length);
    } catch {
      /* offline or signed out: keep them and try again next time */
    }
    sending.current = false;
  }, []);

  const keepAwake = useCallback(async () => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLock> } };
    if (!nav.wakeLock) {
      setLock("unsupported");
      return;
    }
    try {
      const l = await nav.wakeLock.request("screen");
      wake.current = l;
      setLock("on");
      l.addEventListener("release", () => setLock("off"));
    } catch {
      setLock("off");
    }
  }, []);

  const stopWatching = () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    void wake.current?.release().catch(() => {});
    wake.current = null;
  };

  const start = useCallback(
    (from?: State) => {
      if (!("geolocation" in navigator)) {
        setGps("error");
        return;
      }
      const s: State = from ?? { session: newSession(), startedAt: Date.now(), meters: 0 };
      stateRef.current = s;
      last.current = null;
      setState({ ...s });
      setResume(null);
      setHidden(false);
      setGps("waiting");
      save();
      void keepAwake();
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          const cur = stateRef.current;
          if (!cur) return;
          if (pos.coords.accuracy > MAX_ACCURACY_M) {
            setGps("weak");
            return;
          }
          setGps("ok");
          const p: PatrolPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy), at: new Date(pos.timestamp || Date.now()).toISOString() };
          const prev = last.current;
          const d = prev ? meters(prev.lat, prev.lng, p.lat, p.lng) : Infinity;
          if (d < RECORD_EVERY_M) return;
          if (prev && d < 5000) cur.meters += d;
          last.current = p;
          queue.current.push(p);
          setState({ ...cur });
          save();
          if (queue.current.length >= 20) void flush(cur.session);
        },
        (err) => setGps(err.code === 1 ? "denied" : "error"),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flush, keepAwake],
  );

  const stop = useCallback(() => {
    const s = stateRef.current;
    stopWatching();
    stateRef.current = null;
    setState(null);
    write(STATE_KEY, null);
    void flush(s?.session);
  }, [flush]);

  // on load: upload anything left from last time, and offer to resume a patrol that was cut off (page closed, phone restarted)
  useEffect(() => {
    const q = read<{ session: string | null; points: PatrolPoint[] }>(QUEUE_KEY);
    if (q?.session && Array.isArray(q.points) && q.points.length) {
      queue.current = q.points;
      setPending(q.points.length);
      void flush(q.session);
    }
    const s = read<State>(STATE_KEY);
    if (s?.session && Date.now() - s.startedAt < MAX_HOURS * 3_600_000) setResume(s);
    else write(STATE_KEY, null);
    return () => stopWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // while patrolling: upload every 30 s, stop after 10 hours, and take the screen lock back after the page was hidden
  useEffect(() => {
    if (!state) return;
    const t = window.setInterval(() => {
      tick((n) => n + 1);
      const s = stateRef.current;
      if (!s) return;
      if (Date.now() - s.startedAt > MAX_HOURS * 3_600_000) stop();
      else void flush(s.session);
    }, FLUSH_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        if (stateRef.current) void keepAwake();
      } else setHidden(true);
    };
    document.addEventListener("visibilitychange", onVis);
    const onOnline = () => void flush(stateRef.current?.session);
    window.addEventListener("online", onOnline);
    const second = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(second);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
    };
  }, [state !== null, flush, keepAwake, stop]); // eslint-disable-line react-hooks/exhaustive-deps

  const box: React.CSSProperties = {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--surface-border, #d1d5db)",
    borderRadius: 14,
    padding: "8px 12px",
    margin: "0 0 12px",
    background: "var(--surface, #fff)",
  };
  const note: React.CSSProperties = { fontSize: 13, lineHeight: 1.45, opacity: 0.8, margin: "8px 0 0" };

  if (!state) {
    return (
      <div style={box} data-testid="patrol-bar">
        {resume ? (
          <>
            <b>Your patrol was cut off</b> ({miles(resume.meters)} mi so far).
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button type="button" style={btn("#16a34a")} data-testid="patrol-resume" onClick={() => start(resume)}>
                Resume patrolling
              </button>
              <button
                type="button"
                style={btn("transparent", "inherit")}
                onClick={() => {
                  setResume(null);
                  write(STATE_KEY, null);
                }}
              >
                End it
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={{ ...btn("#16a34a"), flex: "0 0 auto" }} data-testid="patrol-start" onClick={() => start()}>
              Start patrolling
            </button>
            <span style={{ ...note, margin: 0, flex: "1 1 220px" }}>
              Driving around looking? Turn this on. It records the streets you cover (only while it&apos;s on) so crews don&apos;t double up. Kept{" "}
              {KEEP_DAYS} days. Keep this page open, phone on a charger.
              {pending > 0 && ` ${pending} points waiting to upload.`}
            </span>
          </div>
        )}
        {resume && (
          <p style={note}>
            Records the streets you cover (only while it&apos;s on). Kept {KEEP_DAYS} days.
            {pending > 0 && ` ${pending} points waiting to upload.`}
          </p>
        )}
      </div>
    );
  }

  const warn =
    gps === "denied"
      ? "Location is blocked. Allow location for this site in your browser settings, then tap Stop and Start."
      : gps === "error"
        ? "Can't get a GPS fix. Check that location is on."
        : gps === "weak"
          ? "GPS signal is weak. Points are skipped until it improves."
          : gps === "waiting"
            ? "Waiting for GPS…"
            : null;
  return (
    <div style={{ ...box, borderColor: "#16a34a" }} data-testid="patrol-bar" data-active="true">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 12, height: 12, borderRadius: 6, background: "#16a34a", boxShadow: "0 0 0 4px rgba(22,163,74,.25)" }} />
        <b style={{ fontSize: 16 }} data-testid="patrol-status">
          Patrolling · {miles(state.meters)} mi · {clock(Date.now() - state.startedAt)}
        </b>
        <button type="button" style={{ ...btn("#dc2626"), marginLeft: "auto" }} data-testid="patrol-stop" onClick={stop}>
          Stop
        </button>
      </div>
      {warn && <p style={{ ...note, opacity: 1, color: "#b45309", fontWeight: 600 }}>{warn}</p>}
      <p style={note} data-testid="patrol-lock">
        {lock === "on"
          ? "Screen is kept on while patrolling."
          : lock === "unsupported"
            ? "This phone can't keep the screen on from a web page: set Auto-Lock to Never while patrolling, or it will pause when the screen locks."
            : "Keep this page open: recording pauses if the screen locks or you switch apps."}
        {hidden && " It was paused while the page was hidden."}
        {pending > 0 && ` ${pending} points waiting to upload.`}
      </p>
    </div>
  );
}
