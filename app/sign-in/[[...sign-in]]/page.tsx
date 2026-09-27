import { SignIn } from "@clerk/nextjs";

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

export default function SignInPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 24px",
      }}
    >
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center", marginBottom: 32 }}>
        <p
          style={{
            fontFamily: mono,
            fontSize: 13,
            letterSpacing: "0.02em",
            color: "var(--text-dim)",
            margin: "0 0 16px 0",
          }}
        >
          isaacborland.com
        </p>
        <h1
          style={{
            fontFamily: mono,
            fontWeight: 600,
            fontSize: 26,
            lineHeight: 1.3,
            margin: "0 0 12px 0",
          }}
        >
          Personal project hub
        </h1>
        <p
          style={{
            fontFamily: sans,
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text-dim)",
            margin: 0,
          }}
        >
          Invite-only. If you don't have an invite, this isn't the place for
          you yet.
        </p>
      </div>

      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#e8703a",
            colorBackground: "var(--surface)",
            colorText: "var(--text)",
            colorTextSecondary: "var(--text-dim)",
            colorInputBackground: "var(--bg)",
            colorInputText: "var(--text)",
            borderRadius: "6px",
            fontFamily: sans,
          },
          elements: {
            card: {
              border: "1px solid var(--surface-border)",
              boxShadow: "none",
            },
            headerTitle: { fontFamily: mono },
            footer: { display: "none" },
          },
        }}
      />
    </main>
  );
}
