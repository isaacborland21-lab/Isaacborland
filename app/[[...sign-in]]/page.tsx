import { SignIn } from "@clerk/nextjs";

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
      <div style={{ marginBottom: 28, textAlign: "left", maxWidth: 380 }}>
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
            fontSize: 28,
            lineHeight: 1.3,
            margin: 0,
            color: "var(--off-white)",
          }}
        >
          Project hub.
          <br />
          Sign in to keep building.
        </h1>
      </div>

      <div className="card">
        <SignIn
          routing="path"
          path="/"
          fallbackRedirectUrl="/dashboard"
          appearance={{
            variables: {
              colorPrimary: "#e8a33d",
              colorBackground: "#13315c",
              colorText: "#edeff2",
              colorTextSecondary: "#a9b4c4",
              colorInputBackground: "#0b1d33",
              colorInputText: "#edeff2",
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              borderRadius: "4px",
            },
            elements: {
              card: {
                boxShadow: "none",
                border: "1px solid #1e4a80",
              },
              headerTitle: { fontFamily: "'IBM Plex Mono', monospace" },
              footer: { display: "none" },
            },
          }}
        />
      </div>

      <p
        style={{
          marginTop: 24,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 12,
          color: "var(--off-white-dim)",
          maxWidth: 380,
        }}
      >
        Invite-only. If you don't have an invite, you don't have access — and
        that's by design.
      </p>
    </main>
  );
}
