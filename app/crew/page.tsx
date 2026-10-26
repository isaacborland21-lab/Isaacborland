"use client";

import { useEffect, useState } from "react";
import { SignIn, SignOutButton, UserButton, useUser } from "@clerk/nextjs";
import AliveBackground from "../AliveBackground";
import GraffitiTab from "../graffiti/GraffitiTab";
import JobsTab from "../jobs/JobsTab";
import gstyles from "../graffiti/graffiti.module.css";
import { JOB_TYPE_LABEL, JobType } from "@/lib/jobs";
import type { PublicMetadata } from "@/lib/supabaseAdmin";

// Crew entry point: sign in here and only the trackers this account was given are on the page (graffiti, work orders,
// lawn care, other jobs) — no hub tabs.
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

type CrewTab = "graffiti" | JobType;
const CREW_TABS: { key: CrewTab; label: string }[] = [
  { key: "graffiti", label: "Graffiti" },
  { key: "workorders", label: JOB_TYPE_LABEL.workorders },
  { key: "lawn", label: JOB_TYPE_LABEL.lawn },
  { key: "otherjobs", label: JOB_TYPE_LABEL.otherjobs },
];

export default function CrewPage() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [picked, setPicked] = useState<CrewTab | null>(null);

  // One-time flag so the main page can send a crew sign-in back here if Clerk lands it there.
  useEffect(() => {
    if (!isLoaded) return;
    try {
      if (isSignedIn) window.sessionStorage.removeItem("crewLogin");
      else window.sessionStorage.setItem("crewLogin", "1");
    } catch {
      /* private mode: skip */
    }
  }, [isLoaded, isSignedIn]);

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
              Field trackers. Invite-only.
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
  const mine = CREW_TABS.filter((t) => isOwner || meta.tabAdmin?.[t.key] === true);
  const allowed = mine.length > 0;
  const current = mine.find((t) => t.key === picked)?.key ?? mine[0]?.key;

  if (!allowed) {
    return (
      <>
        <AliveBackground />
        <main style={wrap}>
          <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
            <h1 style={{ fontFamily: mono, fontWeight: 600, fontSize: 24, margin: "0 0 12px" }}>No crew access yet</h1>
            <p style={{ fontFamily: sans, fontSize: 14, lineHeight: 1.6, color: "var(--text-dim)", margin: "0 0 20px" }}>
              You're signed in, but this account hasn't been given any of the trackers. Ask Isaac to turn them on for you.
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
          {isOwner && (
            <a href="/?tab=home" style={{ fontFamily: mono, fontSize: 13, color: "var(--accent)" }}>
              Open full site →
            </a>
          )}
        </header>
        <div className="tab-content">
          {mine.length > 1 && (
            <div className={gstyles.root}>
              <nav className={gstyles.subnav} aria-label="Trackers" data-testid="crew-tabs">
                {mine.map((t) => (
                  <button key={t.key} type="button" className={current === t.key ? gstyles.on : undefined} aria-pressed={current === t.key} onClick={() => setPicked(t.key)}>
                    {t.label}
                  </button>
                ))}
              </nav>
            </div>
          )}
          {current === "graffiti" && <GraffitiTab isOwner={isOwner} canInvoice={isOwner || meta.tabAdmin?.invoice === true} />}
          {current && current !== "graffiti" && <JobsTab key={current} jtype={current} isOwner={isOwner} />}
        </div>
      </main>
    </>
  );
}
