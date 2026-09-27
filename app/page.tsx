"use client";

import { useState } from "react";

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

export default function HomePage() {
  const [active, setActive] = useState<Tab>("Home");

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        padding: "64px 24px",
      }}
    >
      <div style={{ maxWidth: 560, width: "100%" }}>
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
          <p
            id="season-label"
            style={{
              fontFamily: mono,
              fontSize: 12,
              color: "var(--accent)",
              margin: 0,
            }}
          />
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

      <script
        // Reads the season the server already computed (data-season on
        // <html>) and shows it as a small label, without needing a second
        // client-side date calculation that could disagree with the server.
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              var season = document.documentElement.getAttribute('data-season');
              var labels = ${JSON.stringify(seasonLabels)};
              var el = document.getElementById('season-label');
              if (el && season && labels[season]) el.textContent = labels[season];
            })();
          `,
        }}
      />
    </main>
  );
}
