// Placeholder project list for now. Swap this for real data once there's
// something to link to.
const projects = [
  { name: "Gmail cleanup", status: "in progress" },
  { name: "HME NEXEO dashboard", status: "planned" },
];

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: 420, width: "100%" }}>
        <p
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13,
            letterSpacing: "0.02em",
            color: "var(--off-white-dim)",
            margin: "0 0 6px 0",
          }}
        >
          isaacborland.com
        </p>
        <h1
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600,
            fontSize: 32,
            lineHeight: 1.3,
            margin: "0 0 12px 0",
            color: "var(--off-white)",
          }}
        >
          Project hub.
        </h1>
        <p
          style={{
            fontFamily: "'IBM Plex Sans', sans-serif",
            fontSize: 15,
            lineHeight: 1.5,
            color: "var(--off-white-dim)",
            margin: "0 0 32px 0",
          }}
        >
          A running list of things I'm building. Login coming later — for
          now, here's what's in progress.
        </p>

        <div className="card">
          {projects.map((p) => (
            <div
              key={p.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 18px",
                marginBottom: 10,
                border: "1px solid var(--line-blue)",
                background: "var(--line-blue-faint)",
                borderRadius: 4,
                fontFamily: "'IBM Plex Sans', sans-serif",
              }}
            >
              <span>{p.name}</span>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12,
                  color: "var(--off-white-dim)",
                }}
              >
                {p.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
