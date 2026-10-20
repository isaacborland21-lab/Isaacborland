"use client";

import { SignIn, SignOutButton, UserButton, useUser } from "@clerk/nextjs";
import AliveBackground from "../AliveBackground";
import GraffitiTab from "../graffiti/GraffitiTab";
import type { PublicMetadata } from "@/lib/supabaseAdmin";

// Crew entry point: sign in here and the graffiti tracker is the ONLY thing on the page (no other tabs).
// Showing or hiding is only cosmetic. The real permission check is in the /api/graffiti routes.

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

const clerkAppearance = {
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
    card: { border: "1px solid var(--surface-border)", boxShadow: "none" },
    headerTitle: { fontFamily: mono },
    footer: { display: "none" },
  },
};

const wrap = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  padding: "64px 24px",
  position: "relative" as const,
  zIndex: 1,
};

export default function CrewPage() {
  const { user, isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <>
        <AliveBackground />
        <main style={wrap}>
          <p style={{ fontFamily: sans, color: "var(--text-dim)" }}>Loading…</p>
        </main>
      </>
    );
  }

  if (!isSignedIn) {
    return (
      <>
        <AliveBackground />
        <main style={wrap}>
          <div style={{ maxWidth: 420, width: "100%", textAlign: "center", marginBottom: 28 }}>
            <p style={{ fontFamily: mono, fontSize: 13, color: "var(--text-dim)", margin: "0 0 16px" }}>isaacborland.com</p>
            <h1 style={{ fontFamily: mono, fontWeight: 600, fontSize: 26, lineHeight: 1.3, margin: "0 0 12px" }}>Crew login</h1>
            <p style={{ fontFamily: sans, fontSize: 14, lineHeight: 1.6, color: "var(--text-dim)", margin: 0 }}>
              Graffiti removal tracker. Invite-only.
            </p>
          </div>
          <SignIn routing="hash" forceRedirectUrl="/crew" appearance={clerkAppearance} />
          <a href="/sign-in" style={{ fontFamily: mono, fontSize: 13, color: "var(--text-dim)", marginTop: 24 }}>
            ← Back
          </a>
        </main>
      </>
    );
  }

  const meta = (user?.publicMetadata ?? {}) as PublicMetadata;
  const isOwner = meta.owner === true;
  const allowed = isOwner || meta.tabAdmin?.graffiti === true;

  if (!allowed) {
    return (
      <>
        <AliveBackground />
        <main style={wrap}>
          <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
            <h1 style={{ fontFamily: mono, fontWeight: 600, fontSize: 24, margin: "0 0 12px" }}>No crew access yet</h1>
            <p style={{ fontFamily: sans, fontSize: 14, lineHeight: 1.6, color: "var(--text-dim)", margin: "0 0 20px" }}>
              You're signed in, but this account hasn't been given the graffiti tracker. Ask Isaac to turn it on for you.
            </p>
            <SignOutButton redirectUrl="/sign-in">
              <button
                style={{
                  fontFamily: sans,
                  fontSize: 15,
                  fontWeight: 600,
                  padding: "12px 20px",
                  borderRadius: 10,
                  border: "1px solid var(--surface-border)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                Sign out
              </button>
            </SignOutButton>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <AliveBackground />
      <main className="shell" style={{ paddingBottom: 48 }}>
        <header className="topbar" style={{ marginBottom: 20 }}>
          <div className="brand">
            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{
                ...clerkAppearance,
                elements: {
                  avatarBox: { width: 30, height: 30 },
                  userButtonPopoverCard: { border: "1px solid var(--surface-border)", boxShadow: "none" },
                },
              }}
            />
            <p className="site-name">isaacborland.com · Crew</p>
          </div>
        </header>
        <div className="tab-content">
          <GraffitiTab isOwner={isOwner} />
        </div>
      </main>
    </>
  );
}
