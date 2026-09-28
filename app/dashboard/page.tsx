"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AliveBackground from "../AliveBackground";
import styles from "./dashboard.module.css";

// ============================================================
// Room dashboard — meant to live full-screen on a spare screen.
// Clock, Bozeman weather, and Apple Calendar "next up".
// Keeps the screen awake, dims itself overnight, nudges its layout a few
// pixels every so often (burn-in), and reloads itself every few hours so
// new deploys show up without anyone touching it.
// ============================================================

// Pinned location: a room display shouldn't guess where it is from its IP.
const PLACE = { name: "Bozeman", lat: 45.677, lon: -111.0429, tz: "America/Denver" };

const WEATHER_EVERY_MS = 10 * 60 * 1000;
const CALENDAR_EVERY_MS = 5 * 60 * 1000;
const RELOAD_EVERY_MS = 6 * 60 * 60 * 1000;
const NIGHT_START = 23; // 11 pm
const NIGHT_END = 6; // 6 am

// ---------------- Types ----------------

type CalEvent = {
  id: string;
  title: string;
  location: string | null;
  calendar: string | null;
  start: string;
  end: string;
  allDay: boolean;
};

type CalState =
  | { status: "loading" }
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "ok"; events: CalEvent[]; errors: string[] };

type Weather = {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
    relative_humidity_2m: number;
    is_day: number;
  };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: number[] };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    sunrise: string[];
    sunset: string[];
  };
};

type Kind = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "thunder";

// ---------------- Weather helpers ----------------

function kindOf(code: number): Kind {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunder";
  return "rain";
}

function describe(code: number): string {
  const map: Record<number, string> = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Freezing fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Rain showers",
    82: "Heavy showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorms",
    96: "Storms with hail",
    99: "Storms with hail",
  };
  return map[code] ?? "—";
}

// Open-Meteo returns local wall-clock strings like "2026-09-27T22:00".
function hourLabel(local: string): string {
  const h = parseInt(local.slice(11, 13), 10);
  const suffix = h < 12 ? "a" : "p";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${suffix}`;
}

function clockLabel(local: string): string {
  const h = parseInt(local.slice(11, 13), 10);
  const m = local.slice(14, 16);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

function dayLabel(localDate: string, i: number): string {
  if (i === 0) return "Today";
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function WeatherIcon({ kind, day = true, size = 48 }: { kind: Kind; day?: boolean; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 48 48",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  const sun = (
    <g stroke="#f2b35a">
      <circle cx="24" cy="24" r="8" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1="24" y1="7" x2="24" y2="11" transform={`rotate(${a} 24 24)`} />
      ))}
    </g>
  );
  const moon = <path stroke="#dfe6f2" d="M30 9a14 14 0 1 0 9 22A12 12 0 0 1 30 9Z" />;
  const cloud = (dx = 0, dy = 0) => (
    <path
      transform={`translate(${dx} ${dy})`}
      d="M14 36h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0 1 13Z"
      style={{ fill: "color-mix(in srgb, var(--surface) 70%, transparent)" }}
    />
  );
  switch (kind) {
    case "clear":
      return <svg {...p}>{day ? sun : moon}</svg>;
    case "partly":
      return (
        <svg {...p}>
          <g transform="translate(-6 -7) scale(0.8)">{day ? sun : moon}</g>
          {cloud(2, 3)}
        </svg>
      );
    case "cloudy":
      return <svg {...p}>{cloud(0, 0)}</svg>;
    case "fog":
      return (
        <svg {...p}>
          {cloud(0, -6)}
          <line x1="9" y1="38" x2="39" y2="38" />
          <line x1="14" y1="43" x2="34" y2="43" />
        </svg>
      );
    case "rain":
      return (
        <svg {...p}>
          {cloud(0, -6)}
          <g stroke="#8ec5ff">
            <line x1="17" y1="36" x2="15" y2="42" />
            <line x1="25" y1="36" x2="23" y2="42" />
            <line x1="33" y1="36" x2="31" y2="42" />
          </g>
        </svg>
      );
    case "snow":
      return (
        <svg {...p}>
          {cloud(0, -6)}
          <g stroke="#e6f4ff" strokeWidth={3}>
            <line x1="16" y1="39" x2="16" y2="39.1" />
            <line x1="24" y1="42" x2="24" y2="42.1" />
            <line x1="32" y1="39" x2="32" y2="39.1" />
          </g>
        </svg>
      );
    case "thunder":
      return (
        <svg {...p}>
          {cloud(0, -6)}
          <path stroke="#f2b35a" d="m25 32-4 7h6l-4 7" />
        </svg>
      );
  }
}

// ---------------- Calendar helpers ----------------

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function span(mins: number): string {
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) {
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function whenLabel(ev: CalEvent, now: Date): string {
  const start = new Date(ev.start);
  const today = dateKey(now);
  const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const k = dateKey(start);
  if (k === today) return `Today · ${timeOf(ev.start)}`;
  if (k === tomorrow) return `Tomorrow · ${timeOf(ev.start)}`;
  return `${start.toLocaleDateString([], { weekday: "long" })} · ${timeOf(ev.start)}`;
}

// ---------------- Hooks ----------------

function useWakeLock() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    type Sentinel = { release: () => Promise<void>; addEventListener: (t: "release", cb: () => void) => void };
    type WakeNav = Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } };
    const nav = navigator as WakeNav;
    if (!nav.wakeLock) return;
    let sentinel: Sentinel | null = null;
    let stopped = false;

    const acquire = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        sentinel = await nav.wakeLock!.request("screen");
        setHeld(true);
        sentinel.addEventListener("release", () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    // Some browsers only grant it after a tap — try again on the first one.
    window.addEventListener("pointerdown", acquire, { once: true });
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => {});
    };
  }, []);
  return held;
}

function useTicker(everyMs: number) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

// ---------------- Pieces ----------------

function Clock() {
  const now = useTicker(1000);
  if (!now) return <div className={styles.clockBlock} />;
  const h = now.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return (
    <div className={styles.clockBlock}>
      <div className={styles.time}>
        <span>
          {h12}
          <span className={styles.colon}>:</span>
          {mm}
        </span>
        <span className={styles.timeSide}>
          <span className={styles.ampm}>{h < 12 ? "AM" : "PM"}</span>
          <span className={styles.seconds}>{ss}</span>
        </span>
      </div>
      <div className={styles.date}>{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>
    </div>
  );
}

function NextUp({ cal, now }: { cal: CalState; now: Date }) {
  if (cal.status !== "ok") {
    return (
      <section className={`card ${styles.nextCard}`}>
        <p className={styles.eyebrow}>Next up</p>
        <CalendarStatus cal={cal} />
      </section>
    );
  }

  const nowMs = now.getTime();
  const timed = cal.events.filter((e) => !e.allDay && new Date(e.end).getTime() > nowMs);
  const current = timed.find((e) => new Date(e.start).getTime() <= nowMs) ?? null;
  const upcoming = timed.filter((e) => new Date(e.start).getTime() > nowMs);
  const main = current ?? upcoming[0] ?? null;
  const after = current ? upcoming[0] ?? null : upcoming[1] ?? null;

  if (!main) {
    return (
      <section className={`card ${styles.nextCard}`}>
        <p className={styles.eyebrow}>Next up</p>
        <p className={styles.nextTitle}>Nothing scheduled</p>
        <p className={styles.nextMeta}>Your week is clear.</p>
      </section>
    );
  }

  const startMs = new Date(main.start).getTime();
  const endMs = new Date(main.end).getTime();
  const live = startMs <= nowMs;
  const mins = Math.max(0, Math.round(((live ? endMs : startMs) - nowMs) / 60000));
  const soon = !live && mins <= 15;
  const pct = live && endMs > startMs ? Math.min(100, ((nowMs - startMs) / (endMs - startMs)) * 100) : 0;

  return (
    <section className={`card ${styles.nextCard} ${live ? styles.live : ""} ${soon ? styles.soon : ""}`}>
      <div className={styles.nextHead}>
        <p className={styles.eyebrow}>{live ? "Happening now" : "Next up"}</p>
        <span className={styles.countdown}>{live ? `ends in ${span(mins)}` : `in ${span(mins)}`}</span>
      </div>
      <p className={styles.nextTitle}>{main.title}</p>
      <p className={styles.nextMeta}>
        {live ? `${timeOf(main.start)} – ${timeOf(main.end)}` : `${whenLabel(main, now)} – ${timeOf(main.end)}`}
        {main.location ? <span className={styles.loc}> · {main.location.split("\n")[0]}</span> : null}
      </p>
      {live && (
        <div className="progress" style={{ marginTop: 18 }}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      {after && (
        <p className={styles.after}>
          Then <strong>{after.title}</strong> · {whenLabel(after, now)}
        </p>
      )}
    </section>
  );
}

function CalendarStatus({ cal }: { cal: CalState }) {
  if (cal.status === "loading") return <p className={styles.muted}>Loading calendar…</p>;
  if (cal.status === "unconfigured")
    return (
      <p className={styles.muted}>
        Calendar isn&apos;t connected yet. Add your iCloud calendar link as <code>ICLOUD_CALENDAR_URLS</code> in Vercel.
      </p>
    );
  if (cal.status === "signed-out")
    return (
      <p className={styles.muted}>
        Signed out. <Link href="/sign-in">Sign in again</Link> to load your calendar.
      </p>
    );
  if (cal.status === "error") return <p className={styles.muted}>{cal.message}</p>;
  return null;
}

function Agenda({ cal, now }: { cal: CalState; now: Date }) {
  const groups = useMemo(() => {
    if (cal.status !== "ok") return null;
    const nowMs = now.getTime();
    const today = dateKey(now);
    const tmr = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const pick = (k: string) => {
      const evs = cal.events.filter((e) => dateKey(new Date(e.start)) === k || (e.allDay && k === today && new Date(e.start).getTime() <= nowMs && new Date(e.end).getTime() > nowMs));
      return {
        allDay: evs.filter((e) => e.allDay),
        timed: evs.filter((e) => !e.allDay && (k !== today || new Date(e.end).getTime() > nowMs)),
      };
    };
    return [
      { label: "Today", ...pick(today) },
      { label: "Tomorrow", ...pick(tmr) },
    ];
  }, [cal, now]);

  return (
    <section className={`card ${styles.agendaCard}`}>
      {!groups ? (
        <CalendarStatus cal={cal} />
      ) : (
        groups.map((g) => (
          <div key={g.label} className={styles.agendaGroup}>
            <p className={styles.eyebrow}>{g.label}</p>
            {g.allDay.length > 0 && (
              <div className={styles.chips}>
                {g.allDay.map((e) => (
                  <span key={e.id} className={styles.allDayChip}>
                    {e.title}
                  </span>
                ))}
              </div>
            )}
            {g.timed.length === 0 && g.allDay.length === 0 && <p className={styles.muted}>Nothing scheduled</p>}
            <ul className={styles.agendaList}>
              {g.timed.slice(0, 6).map((e) => {
                const live = new Date(e.start).getTime() <= now.getTime();
                return (
                  <li key={e.id} className={live ? styles.agendaLive : undefined}>
                    <span className={styles.agendaTime}>{timeOf(e.start)}</span>
                    <span className={styles.agendaTitle}>{e.title}</span>
                  </li>
                );
              })}
              {g.timed.length > 6 && <li className={styles.muted}>+{g.timed.length - 6} more</li>}
            </ul>
          </div>
        ))
      )}
      {cal.status === "ok" && cal.errors.length > 0 && <p className={styles.warn}>{cal.errors.join(" · ")}</p>}
    </section>
  );
}

function WeatherPanel({ wx, failed }: { wx: Weather | null; failed: boolean }) {
  if (!wx) {
    return (
      <section className={`card ${styles.weatherCard}`}>
        <p className={styles.eyebrow}>{PLACE.name}</p>
        <p className={styles.muted}>{failed ? "Weather unavailable right now — retrying." : "Loading weather…"}</p>
      </section>
    );
  }

  const c = wx.current;
  const currentHour = c.time.slice(0, 13);
  let startIdx = wx.hourly.time.findIndex((t) => t.slice(0, 13) >= currentHour);
  if (startIdx < 0) startIdx = 0;
  const hours = wx.hourly.time.slice(startIdx, startIdx + 8).map((t, i) => ({
    t,
    temp: Math.round(wx.hourly.temperature_2m[startIdx + i]),
    code: wx.hourly.weather_code[startIdx + i],
    pop: wx.hourly.precipitation_probability[startIdx + i] ?? 0,
  }));
  const todayIdx = Math.max(0, wx.daily.time.indexOf(c.time.slice(0, 10)));
  const days = wx.daily.time.slice(todayIdx, todayIdx + 5).map((d, i) => ({
    d,
    label: dayLabel(d, i),
    code: wx.daily.weather_code[todayIdx + i],
    hi: Math.round(wx.daily.temperature_2m_max[todayIdx + i]),
    lo: Math.round(wx.daily.temperature_2m_min[todayIdx + i]),
    pop: wx.daily.precipitation_probability_max[todayIdx + i] ?? 0,
  }));
  const allLo = Math.min(...days.map((d) => d.lo));
  const allHi = Math.max(...days.map((d) => d.hi));
  const range = Math.max(1, allHi - allLo);
  const day = c.is_day === 1;
  const sunset = wx.daily.sunset[todayIdx];
  // Before dawn the next sunrise is today's; after sunset it's tomorrow's.
  const nextSunrise =
    wx.daily.sunrise[todayIdx] && c.time < wx.daily.sunrise[todayIdx] ? wx.daily.sunrise[todayIdx] : wx.daily.sunrise[todayIdx + 1];

  return (
    <section className={`card ${styles.weatherCard}`}>
      <div className={styles.wxNow}>
        <div className={styles.wxIcon}>
          <WeatherIcon kind={kindOf(c.weather_code)} day={day} size={96} />
        </div>
        <div>
          <div className={styles.wxTemp}>{Math.round(c.temperature_2m)}°</div>
          <div className={styles.wxCond}>{describe(c.weather_code)}</div>
        </div>
        <div className={styles.wxFacts}>
          <span>{PLACE.name}</span>
          <span>Feels {Math.round(c.apparent_temperature)}°</span>
          <span>
            H {days[0]?.hi}° · L {days[0]?.lo}°
          </span>
          <span>
            Wind {Math.round(c.wind_speed_10m)}
            {c.wind_gusts_10m > c.wind_speed_10m + 8 ? `–${Math.round(c.wind_gusts_10m)}` : ""} mph
          </span>
          {day && sunset && <span>Sunset {clockLabel(sunset)}</span>}
          {!day && nextSunrise && <span>Sunrise {clockLabel(nextSunrise)}</span>}
        </div>
      </div>

      <div className={styles.hourly}>
        {hours.map((h, i) => (
          <div key={h.t} className={styles.hour}>
            <span className={styles.hourLabel}>{i === 0 ? "Now" : hourLabel(h.t)}</span>
            <WeatherIcon kind={kindOf(h.code)} day={parseInt(h.t.slice(11, 13), 10) >= 7 && parseInt(h.t.slice(11, 13), 10) < 20} size={30} />
            <span className={styles.hourTemp}>{h.temp}°</span>
            <span className={styles.pop}>{h.pop >= 20 ? `${h.pop}%` : " "}</span>
          </div>
        ))}
      </div>

      <div className={styles.daily}>
        {days.map((d) => (
          <div key={d.d} className={styles.dayRow}>
            <span className={styles.dayName}>{d.label}</span>
            <WeatherIcon kind={kindOf(d.code)} size={26} />
            <span className={styles.pop}>{d.pop >= 20 ? `${d.pop}%` : ""}</span>
            <span className={styles.lo}>{d.lo}°</span>
            <span className={styles.bar}>
              <span
                className={styles.barFill}
                style={{ left: `${((d.lo - allLo) / range) * 100}%`, right: `${100 - ((d.hi - allLo) / range) * 100}%` }}
              />
            </span>
            <span className={styles.hi}>{d.hi}°</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------- Page ----------------

export default function DashboardPage() {
  const now = useTicker(15_000);
  const awake = useWakeLock();
  const [wx, setWx] = useState<Weather | null>(null);
  const [wxFailed, setWxFailed] = useState(false);
  const [cal, setCal] = useState<CalState>({ status: "loading" });
  const [updated, setUpdated] = useState<Date | null>(null);
  const [chrome, setChrome] = useState(true);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [isFull, setIsFull] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const loadWeather = useCallback(async () => {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}` +
        `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,is_day` +
        `&hourly=temperature_2m,weather_code,precipitation_probability` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(PLACE.tz)}&forecast_days=7`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setWx(await res.json());
      setWxFailed(false);
      setUpdated(new Date());
    } catch {
      setWxFailed(true); // keep showing the last good reading if we have one
    }
  }, []);

  const signedOutResponse = (res: Response) =>
    res.status === 401 || res.status === 404 || res.type === "opaqueredirect" || res.status === 307 || res.status === 302;

  const loadCalendar = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar", { cache: "no-store", redirect: "manual" });
      if (signedOutResponse(res)) {
        setCal({ status: "signed-out" });
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!data.configured) setCal({ status: "unconfigured" });
      else setCal({ status: "ok", events: data.events ?? [], errors: data.errors ?? [] });
      setUpdated(new Date());
    } catch {
      // Keep the last good calendar on screen; only show an error if we never had one.
      setCal((prev) => (prev.status === "ok" ? prev : { status: "error", message: "Couldn't load the calendar — retrying." }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data refresh loops (+ refresh when the screen comes back on).
  useEffect(() => {
    loadWeather();
    loadCalendar();
    const w = window.setInterval(loadWeather, WEATHER_EVERY_MS);
    const c = window.setInterval(loadCalendar, CALENDAR_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadWeather();
        loadCalendar();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(w);
      window.clearInterval(c);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadWeather, loadCalendar]);

  // Reload every few hours so new deploys and a fresh session get picked up.
  useEffect(() => {
    const t = window.setTimeout(() => window.location.reload(), RELOAD_EVERY_MS);
    return () => window.clearTimeout(t);
  }, []);

  // Burn-in protection: drift the whole layout a few pixels every 10 min.
  useEffect(() => {
    const t = window.setInterval(() => {
      setShift({ x: Math.round((Math.random() - 0.5) * 10), y: Math.round((Math.random() - 0.5) * 10) });
    }, 10 * 60 * 1000);
    return () => window.clearInterval(t);
  }, []);

  // Controls fade out when nobody's touching it.
  useEffect(() => {
    const wake = () => {
      setChrome(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setChrome(false), 4000);
    };
    wake();
    const onFs = () => setIsFull(Boolean(document.fullscreenElement));
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      document.removeEventListener("fullscreenchange", onFs);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const hour = now?.getHours() ?? 12;
  const night = hour >= NIGHT_START || hour < NIGHT_END;

  return (
    <div className={`${styles.root} ${night ? styles.night : ""} ${chrome ? "" : styles.idle}`}>
      <AliveBackground />

      <div className={styles.toolbar} data-visible={chrome}>
        <Link href="/" className={styles.toolBtn}>
          ← Home
        </Link>
        <button className={styles.toolBtn} onClick={toggleFull}>
          {isFull ? "Exit full screen" : "Full screen"}
        </button>
      </div>

      <main className={styles.board} style={{ transform: `translate3d(${shift.x}px, ${shift.y}px, 0)` }}>
        <div className={styles.left}>
          <Clock />
          {now && <NextUp cal={cal} now={now} />}
        </div>
        <div className={styles.right}>
          <WeatherPanel wx={wx} failed={wxFailed} />
          {now && <Agenda cal={cal} now={now} />}
        </div>
      </main>

      <footer className={styles.footer}>
        {updated ? `Updated ${updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : " "}
        {awake ? " · screen stays on" : ""}
      </footer>
    </div>
  );
}
