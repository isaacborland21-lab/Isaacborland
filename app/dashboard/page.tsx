import { UserButton } from "@clerk/nextjs";

// Placeholder project list. Swap this for a Supabase query once the
// projects table exists.
const projects = [
  { name: "Gmail cleanup", href: "#", status: "in progress" },
  { name: "HME NEXEO dashboard", href: "#", status: "planned" },
];

export default function DashboardPage() {
  return (
    <main style={{ minHeight: "100vh", padding: "32px 24px" }}>
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 40,
        }}
      >
        <h1
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 22,
            fontWeight: 600,
            margin: 0,
          }}
        >
          Project hub
        </h1>
        <UserButton afterSignOutUrl="/" />
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {projects.map((p) => (
          <a
            key={p.name}
            href={p.href}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 18px",
              marginBottom: 10,
              border: "1px solid var(--line-blue)",
              background: "var(--line-blue-faint)",
              borderRadius: 4,
              textDecoration: "none",
              color: "var(--off-white)",
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
          </a>
        ))}
      </div>
    </main>
  );
}
