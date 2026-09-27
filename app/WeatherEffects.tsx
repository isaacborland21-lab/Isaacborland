"use client";

import { useEffect, useState } from "react";

type WeatherKind = "clear" | "cloudy" | "rain" | "snow" | "thunder" | "fog" | null;

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
export default function WeatherEffects() {
  const [kind, setKind] = useState<WeatherKind>(null);
  const [temp, setTemp] = useState<number | null>(null);
  const [place, setPlace] = useState<string | null>(null);

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

        setKind(kindFromCode(wx?.current?.weather_code));
        if (typeof wx?.current?.temperature_2m === "number") {
          setTemp(Math.round(wx.current.temperature_2m));
        }
        if (typeof city === "string") setPlace(city);
      } catch {
        // Silently degrade — seasonal theme alone still works fine.
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!kind) return null;

  return (
    <>
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
          Array.from({ length: 50 }).map((_, i) => {
            const size = 3 + Math.random() * 4;
            return (
              <span
                key={i}
                className="snowflake"
                style={{
                  left: `${Math.random() * 100}%`,
                  width: size,
                  height: size,
                  animationDuration: `${8 + Math.random() * 8}s`,
                  animationDelay: `${Math.random() * 8}s`,
                }}
              />
            );
          })}

        {kind === "rain" &&
          Array.from({ length: 70 }).map((_, i) => (
            <span
              key={i}
              className="raindrop"
              style={{
                left: `${Math.random() * 100}%`,
                height: 14 + Math.random() * 18,
                animationDuration: `${0.5 + Math.random() * 0.5}s`,
                animationDelay: `${Math.random() * 2}s`,
              }}
            />
          ))}

        {kind === "clear" && <div className="sun-glow" />}
        {(kind === "cloudy" || kind === "fog" || kind === "thunder") && (
          <div className="cloud-veil" />
        )}
      </div>

      {(temp !== null || place) && (
        <p
          style={{
            position: "relative",
            zIndex: 1,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            color: "var(--text-dim)",
            margin: "0 0 8px 0",
          }}
        >
          {place ? `${place} · ` : ""}
          {temp !== null ? `${temp}°F` : ""}
          {kind === "snow" && " · snowing"}
          {kind === "rain" && " · raining"}
          {kind === "clear" && " · clear"}
          {kind === "thunder" && " · storming"}
        </p>
      )}
    </>
  );
}
