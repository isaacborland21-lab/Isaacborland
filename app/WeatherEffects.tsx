"use client";

import { useEffect, useMemo, useState } from "react";

type WeatherKind = "clear" | "cloudy" | "rain" | "snow" | "thunder" | "fog" | null;

export type WeatherInfo = {
  kind: WeatherKind;
  temp: number | null;
  place: string | null;
};

// WMO weather codes, as returned by Open-Meteo.
function kindFromCode(code: number): WeatherKind {
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
    return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunder";
  return null;
}

// Renders a live weather-driven background effect for whoever is viewing the
// page: snow if it's snowing where they are, rain if it's raining, a soft
// sun glow if it's clear, a faint veil if overcast. Uses free, no-key APIs
// (IP-based geolocation + Open-Meteo) so there's nothing to configure and
// nothing that can leak a secret. Fails silently — if either API is
// unreachable or rate-limited, the page just shows the seasonal theme with
// no weather layer, never an error.
//
// This component only renders the fixed, full-viewport visual layer (which
// takes no space in the page's normal flow, so it's safe to mount anywhere).
// It reports what it found via `onWeatherChange` so the caller can place the
// text label wherever fits the page's own layout, instead of this component
// rendering its own flex/box-flow element.
export default function WeatherEffects({
  onWeatherChange,
}: {
  onWeatherChange?: (info: WeatherInfo) => void;
}) {
  const [kind, setKind] = useState<WeatherKind>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const geoRes = await fetch("https://ipapi.co/json/");
        if (!geoRes.ok) return;
        const geo = await geoRes.json();
        const { latitude, longitude, city } = geo ?? {};
        if (!latitude || !longitude) return;

        const wxRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`
        );
        if (!wxRes.ok) return;
        const wx = await wxRes.json();
        if (cancelled) return;

        const resolvedKind = kindFromCode(wx?.current?.weather_code);
        const temp =
          typeof wx?.current?.temperature_2m === "number"
            ? Math.round(wx.current.temperature_2m)
            : null;
        const place = typeof city === "string" ? city : null;

        setKind(resolvedKind);
        onWeatherChange?.({ kind: resolvedKind, temp, place });
      } catch {
        // Silently degrade — seasonal theme alone still works fine.
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // Only ever fetch once per page load; onWeatherChange is a fresh
    // function reference from the caller each render and isn't meant to
    // re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Random positions are generated once per weather kind. Without this, every
  // parent re-render (the header clock ticks every 20s) would re-roll them and
  // make every snowflake/raindrop jump.
  const flakes = useMemo(
    () =>
      Array.from({ length: 50 }, () => {
        const size = 3 + Math.random() * 4;
        return { left: Math.random() * 100, size, duration: 8 + Math.random() * 8, delay: Math.random() * 8 };
      }),
    [kind]
  );
  const drops = useMemo(
    () =>
      Array.from({ length: 70 }, () => ({
        left: Math.random() * 100,
        height: 14 + Math.random() * 18,
        duration: 0.5 + Math.random() * 0.5,
        delay: Math.random() * 2,
      })),
    [kind]
  );

  if (!kind) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {kind === "snow" &&
        flakes.map((f, i) => (
          <span
            key={i}
            className="snowflake"
            style={{
              left: `${f.left}%`,
              width: f.size,
              height: f.size,
              animationDuration: `${f.duration}s`,
              animationDelay: `${f.delay}s`,
            }}
          />
        ))}

      {kind === "rain" &&
        drops.map((d, i) => (
          <span
            key={i}
            className="raindrop"
            style={{
              left: `${d.left}%`,
              height: d.height,
              animationDuration: `${d.duration}s`,
              animationDelay: `${d.delay}s`,
            }}
          />
        ))}

      {kind === "clear" && <div className="sun-glow" />}
      {(kind === "cloudy" || kind === "fog" || kind === "thunder") && (
        <div className="cloud-veil" />
      )}
    </div>
  );
}
