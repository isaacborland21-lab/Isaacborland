"use client";

import { useEffect, useState } from "react";
import WeatherEffects, { WeatherInfo } from "./WeatherEffects";

const projects = [
  { name: "Gmail cleanup", status: "in progress" },
  { name: "HME NEXEO dashboard", status: "planned" },
];

const seasonLabels: Record<string, string> = {
  fall: "Fall theme",
  winter: "Winter theme",
  spring: "Spring theme",
  summer: "Summer theme",
};

const tabs = ["Home", "Projects", "About", "Contact"] as const;
type Tab = (typeof tabs)[number];

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--surface-border)",
        background: "var(--surface)",
        borderRadius: 6,
        padding: "24px",
      }}
    >
      {children}
    </div>
  );
}

function HomeTab() {
  return (
    <Card>
      <h1
        style={{
          fontFamily: mono,
          fontWeight: 600,
          fontSize: 30,
          lineHeight: 1.3,
          margin: "0 0 12px 0",
        }}
      >
        Welcome to isaacborland.com
      </h1>
      <p
        style={{
          fontFamily: sans,
          fontSize: 15,
          lineHeight: 1.6,
          color: "var(--text-dim)",
          margin: 0,
        }}
      >
        This is where I keep the things I'm building. The color palette
        shifts with the seasons — you're currently looking at whichever one
        matches the calendar today.
      </p>
    </Card>
  );
}

function ProjectsTab() {
  return (
    <Card>
      {projects.map((p, i) => (
        <div
          key={p.name}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 0",
            borderTop: i === 0 ? "none" : "1px solid var(--surface-border)",
            fontFamily: sans,
          }}
        >
          <span>{p.name}</span>
          <span style={{ fontFamily: mono, fontSize: 12, color: "var(--text-dim)" }}>
            {p.status}
          </span>
        </div>
      ))}
    </Card>
  );
}

function AboutTab() {
  return (
    <Card>
      <p style={{ fontFamily: sans, fontSize: 15, lineHeight: 1.6, margin: 0 }}>
        I'm Isaac — this site is my personal project hub, where I'm learning
        to build and ship things. More to come here soon.
      </p>
    </Card>
  );
}

function ContactTab() {
  return (
    <Card>
      <p style={{ fontFamily: sans, fontSize: 15, lineHeight: 1.6, margin: "0 0 12px 0" }}>
        Get in touch:
      </p>
      <a
        href="mailto:isaacborland21@gmail.com"
        style={{ fontFamily: mono, fontSize: 15 }}
      >
        isaacborland21@gmail.com
      </a>
    </Card>
  );
}

function weatherText(w: WeatherInfo | null): string {
  if (!w) return "";
  const parts: string[] = [];
  if (w.place) parts.push(w.place);
  if (w.temp !== null) parts.push(`${w.temp}°F`);
  let text = parts.join(" · ");
  if (w.kind === "snow") text += " · snowing";
  if (w.kind === "rain") text += " · raining";
  if (w.kind === "clear") text += " · clear";
  if (w.kind === "thunder") text += " · storming";
  return text;
}

export default function HomePage() {
  const [active, setActive] = useState<Tab>("Home");
  const [season, setSeason] = useState<string>("");
  const [weather, setWeather] = useState<WeatherInfo | null>(null);

  useEffect(() => {
    // Read the season the server already computed (data-season on <html>)
    // rather than recomputing the date client-side, so this never disagrees
    // with what was actually rendered.
    const s = document.documentElement.getAttribute("data-season");
    if (s) setSeason(s);
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        padding: "64px 24px",
        position: "relative",
      }}
    >
      <WeatherEffects onWeatherChange={setWeather} />

      <div style={{ maxWidth: 560, width: "100%", position: "relative", zIndex: 1 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 28,
          }}
        >
          <p
            style={{
              fontFamily: mono,
              fontSize: 13,
              letterSpacing: "0.02em",
              color: "var(--text-dim)",
              margin: 0,
            }}
          >
            isaacborland.com
          </p>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <p
              style={{
                fontFamily: mono,
                fontSize: 12,
                color: "var(--accent)",
                margin: 0,
              }}
            >
              {seasonLabels[season] ?? ""}
            </p>
            {weather && (
              <p
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: "var(--text-dim)",
                  margin: 0,
                }}
              >
                {weatherText(weather)}
              </p>
            )}
          </div>
        </div>

        <nav
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 20,
            borderBottom: "1px solid var(--surface-border)",
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab === active;
            return (
              <button
                key={tab}
                onClick={() => setActive(tab)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "10px 14px",
                  fontFamily: sans,
                  fontSize: 14,
                  color: isActive ? "var(--accent)" : "var(--text-dim)",
                  borderBottom: isActive
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {tab}
              </button>
            );
          })}
        </nav>

        {active === "Home" && <HomeTab />}
        {active === "Projects" && <ProjectsTab />}
        {active === "About" && <AboutTab />}
        {active === "Contact" && <ContactTab />}
      </div>
    </main>
  );
}
