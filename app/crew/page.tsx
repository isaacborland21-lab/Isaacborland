"use client";

import { useEffect, useState } from "react";
import { SignIn, SignOutButton, UserButton, useUser } from "@clerk/nextjs";
import AliveBackground from "../AliveBackground";
import GraffitiTab from "../graffiti/GraffitiTab";
import JobsTab from "../jobs/JobsTab";
import { JOB_TYPES, JobType, canUseJobType } from "@/lib/jobs";
import type { PublicMetadata } from "@/lib/supabaseAdmin";

// Crew entry point: sign in here and pick the kind of job (graffiti, work order, lawn care, other), then log it.
// Graffiti is the default and works exactly as before. Showing or hiding is only cosmetic:
// the real permission checks are in the /api/graffiti and /api/jobs routes (prices are never sent to crew without the invoice switch).

type Kind = "graffiti" | JobType;
const KIND_LABEL: Record<Kind, string> = { graffiti: "Graffiti", workorders: "Work order", lawn: "Lawn care", otherjobs: "Other job" };
const KIND_KEY = "crew_kind";

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
  const [kind, setKind] = useState<Kind>("graffiti");
  const [visited, setVisited] = useState<Set<Kind>>(new Set<Kind>(["graffiti"])); // a tab stays mounted once opened, so a half-filled form isn't lost when switching

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

  // Remember the last kind of job picked on this phone (graffiti is always the starting point on a fresh phone).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KIND_KEY);
      if (saved === "graffiti" || (JOB_TYPES as readonly string[]).includes(saved ?? "")) {
        setKind(saved as Kind);
        setVisited((v) => new Set(v).add(saved as Kind));
      }
    } catch {
      /* private mode: skip */
    }
  }, []);

  function pick(k: Kind) {
    setKind(k);
    setVisited((v) => new Set(v).add(k));
    try {
      window.localStorage.setItem(KIND_KEY, k);
    } catch {
      /* private mode: skip */
    }
  }

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
  const hasGraffiti = isOwner || meta.tabAdmin?.graffiti === true;
  const kinds: Kind[] = [...(hasGraffiti ? (["graffiti"] as Kind[]) : []), ...JOB_TYPES.filter((t) => canUseJobType(meta, t))];
  const allowed = kinds.length > 0;
  const current: Kind = kinds.includes(kind) ? kind : kinds[0];

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
          {isOwner && (
            <a href="/?tab=home" style={{ fontFamily: mono, fontSize: 13, color: "var(--accent)" }}>
              Open full site →
            </a>
          )}
        </header>
        {kinds.length > 1 && (
          <div
            role="group"
            aria-label="What kind of job"
            data-testid="kind-picker"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 16 }}
          >
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={current === k}
                data-testid={`kind-${k}`}
                onClick={() => pick(k)}
                style={{
                  fontFamily: sans,
                  fontSize: 16,
                  fontWeight: 700,
                  minHeight: 52,
                  borderRadius: 12,
                  cursor: "pointer",
                  border: `2px solid ${current === k ? "var(--accent)" : "var(--surface-border)"}`,
                  background: current === k ? "var(--accent)" : "var(--surface)",
                  color: current === k ? "#fff" : "var(--text)",
                }}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        <div className="tab-content">
          {hasGraffiti && (visited.has("graffiti") || current === "graffiti") && (
            <div hidden={current !== "graffiti"}>
              <GraffitiTab isOwner={isOwner} canInvoice={isOwner || meta.tabAdmin?.invoice === true} />
            </div>
          )}
          {JOB_TYPES.filter((t) => kinds.includes(t) && (visited.has(t) || current === t)).map((t) => (
            <div key={t} hidden={current !== t}>
              <JobsTab jtype={t} isOwner={isOwner} />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
