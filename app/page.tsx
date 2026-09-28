"use client";

import { useEffect, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import WeatherEffects, { WeatherInfo } from "./WeatherEffects";
import FoodTab, { FoodContent } from "./FoodTab";

const seasonLabels: Record<string, string> = {
  fall: "Fall theme",
  winter: "Winter theme",
  spring: "Spring theme",
  summer: "Summer theme",
};

const baseTabs = ["Home", "Projects", "Food", "About", "Contact"] as const;
type Tab = (typeof baseTabs)[number] | "Admin";

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--surface-border)",
  borderRadius: 4,
  color: "var(--text)",
  fontFamily: sans,
  fontSize: 14,
  padding: "8px 10px",
};

const buttonBase: React.CSSProperties = {
  fontFamily: sans,
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 4,
  cursor: "pointer",
};

const saveButtonStyle: React.CSSProperties = {
  ...buttonBase,
  background: "var(--accent)",
  border: "none",
  color: "#1a0f08",
  fontWeight: 600,
};

const cancelButtonStyle: React.CSSProperties = {
  ...buttonBase,
  background: "none",
  border: "1px solid var(--surface-border)",
  color: "var(--text-dim)",
};

const editButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: mono,
  fontSize: 12,
  color: "var(--accent)",
  padding: 0,
};

const errorStyle: React.CSSProperties = {
  fontFamily: sans,
  fontSize: 13,
  color: "#e88",
  margin: "8px 0 0 0",
};

type HomeContent = { headline: string; body: string };
type ProjectRow = { name: string; status: string };
type AboutContent = { body: string };
type ContactContent = { body: string; email: string };

type TabContentData = {
  home: HomeContent;
  projects: ProjectRow[];
  food: FoodContent;
  about: AboutContent;
  contact: ContactContent;
};

type EditableTab = "home" | "projects" | "food" | "about" | "contact";

type PublicMetadata = {
  owner?: boolean;
  tabAdmin?: Partial<Record<EditableTab, boolean>>;
};

type AdminUser = {
  id: string;
  email: string;
  firstName: string | null;
  owner: boolean;
  tabAdmin: Partial<Record<EditableTab, boolean>>;
};

const emptyFood: FoodContent = { recipes: [], todos: [] };

function Card({ children, corner }: { children: React.ReactNode; corner?: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        border: "1px solid var(--surface-border)",
        background: "var(--surface)",
        borderRadius: 6,
        padding: "24px",
      }}
    >
      {corner && <div style={{ position: "absolute", top: 16, right: 16 }}>{corner}</div>}
      {children}
    </div>
  );
}

function HomeTab({
  data,
  editable,
  onSave,
}: {
  data: HomeContent;
  editable: boolean;
  onSave: (next: HomeContent) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(data.headline);
  const [body, setBody] = useState(data.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHeadline(data.headline);
    setBody(data.body);
  }, [data]);

  if (editing) {
    return (
      <Card>
        <input value={headline} onChange={(e) => setHeadline(e.target.value)} style={inputStyle} />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          style={{ ...inputStyle, marginTop: 12, resize: "vertical" }}
        />
        {error && <p style={errorStyle}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            disabled={saving}
            style={saveButtonStyle}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onSave({ headline, body });
                setEditing(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            style={cancelButtonStyle}
            onClick={() => {
              setHeadline(data.headline);
              setBody(data.body);
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card corner={editable && <button style={editButtonStyle} onClick={() => setEditing(true)}>Edit</button>}>
      <h1 style={{ fontFamily: mono, fontWeight: 600, fontSize: 30, lineHeight: 1.3, margin: "0 0 12px 0" }}>
        {data.headline}
      </h1>
      <p style={{ fontFamily: sans, fontSize: 15, lineHeight: 1.6, color: "var(--text-dim)", margin: 0 }}>
        {data.body}
      </p>
    </Card>
  );
}

function ProjectsTab({
  data,
  editable,
  onSave,
}: {
  data: ProjectRow[];
  editable: boolean;
  onSave: (next: ProjectRow[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<ProjectRow[]>(data);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(data);
  }, [data]);

  function updateRow(i: number, field: keyof ProjectRow, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  if (editing) {
    return (
      <Card>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              value={row.name}
              placeholder="Project name"
              onChange={(e) => updateRow(i, "name", e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              value={row.status}
              placeholder="Status"
              onChange={(e) => updateRow(i, "status", e.target.value)}
              style={{ ...inputStyle, width: 140 }}
            />
            <button
              onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              style={{ ...cancelButtonStyle, padding: "8px 12px" }}
              aria-label="Remove project"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => setRows((prev) => [...prev, { name: "", status: "" }])}
          style={{ ...editButtonStyle, marginTop: 4 }}
        >
          + Add project
        </button>
        {error && <p style={errorStyle}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            disabled={saving}
            style={saveButtonStyle}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                const cleaned = rows.filter((r) => r.name.trim().length > 0);
                await onSave(cleaned);
                setEditing(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            style={cancelButtonStyle}
            onClick={() => {
              setRows(data);
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card corner={editable && <button style={editButtonStyle} onClick={() => setEditing(true)}>Edit</button>}>
      {data.length === 0 && (
        <p style={{ fontFamily: sans, fontSize: 14, color: "var(--text-dim)", margin: 0 }}>No projects listed.</p>
      )}
      {data.map((p, i) => (
        <div
          key={`${p.name}-${i}`}
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
          <span style={{ fontFamily: mono, fontSize: 12, color: "var(--text-dim)" }}>{p.status}</span>
        </div>
      ))}
    </Card>
  );
}

function AboutTab({
  data,
  editable,
  onSave,
}: {
  data: AboutContent;
  editable: boolean;
  onSave: (next: AboutContent) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(data.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBody(data.body);
  }, [data]);

  if (editing) {
    return (
      <Card>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} style={{ ...inputStyle, resize: "vertical" }} />
        {error && <p style={errorStyle}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            disabled={saving}
            style={saveButtonStyle}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onSave({ body });
                setEditing(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            style={cancelButtonStyle}
            onClick={() => {
              setBody(data.body);
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card corner={editable && <button style={editButtonStyle} onClick={() => setEditing(true)}>Edit</button>}>
      <p style={{ fontFamily: sans, fontSize: 15, lineHeight: 1.6, margin: 0 }}>{data.body}</p>
    </Card>
  );
}

function ContactTab({
  data,
  editable,
  onSave,
}: {
  data: ContactContent;
  editable: boolean;
  onSave: (next: ContactContent) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(data.body);
  const [email, setEmail] = useState(data.email);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBody(data.body);
    setEmail(data.email);
  }, [data]);

  if (editing) {
    return (
      <Card>
        <input value={body} onChange={(e) => setBody(e.target.value)} style={inputStyle} placeholder="Intro line" />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ ...inputStyle, marginTop: 12, fontFamily: mono }}
          placeholder="Email address"
        />
        {error && <p style={errorStyle}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            disabled={saving}
            style={saveButtonStyle}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onSave({ body, email });
                setEditing(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            style={cancelButtonStyle}
            onClick={() => {
              setBody(data.body);
              setEmail(data.email);
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card corner={editable && <button style={editButtonStyle} onClick={() => setEditing(true)}>Edit</button>}>
      <p style={{ fontFamily: sans, fontSize: 15, lineHeight: 1.6, margin: "0 0 12px 0" }}>{data.body}</p>
      <a href={`mailto:${data.email}`} style={{ fontFamily: mono, fontSize: 15 }}>
        {data.email}
      </a>
    </Card>
  );
}

const editableTabKeys = ["home", "projects", "food", "about", "contact"] as const;

function AdminTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/users")
      .then(async (res) => {
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || "Failed to load users.");
        }
        return res.json();
      })
      .then((d) => setUsers(d.users))
      .catch((e) => setError((e as Error).message));
  }, []);

  async function toggle(userId: string, tab: string, allowed: boolean) {
    const key = `${userId}:${tab}`;
    setPending(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userId, tab, allowed }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Failed to update permission.");
      }
      setUsers((prev) =>
        prev
          ? prev.map((u) => (u.id === userId ? { ...u, tabAdmin: { ...u.tabAdmin, [tab]: allowed } } : u))
          : prev
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  if (error) {
    return (
      <Card>
        <p style={errorStyle}>{error}</p>
      </Card>
    );
  }

  if (!users) {
    return (
      <Card>
        <p style={{ fontFamily: sans, fontSize: 14, color: "var(--text-dim)", margin: 0 }}>Loading users…</p>
      </Card>
    );
  }

  return (
    <Card>
      <p style={{ fontFamily: sans, fontSize: 13, color: "var(--text-dim)", margin: "0 0 16px 0" }}>
        Grant or revoke edit access to each tab, per user.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {users.map((u) => (
          <div key={u.id} style={{ borderTop: "1px solid var(--surface-border)", paddingTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexWrap: "wrap", gap: 4 }}>
              <span style={{ fontFamily: sans, fontSize: 14 }}>{u.firstName || u.email}</span>
              <span style={{ fontFamily: mono, fontSize: 11, color: "var(--text-dim)" }}>{u.email}</span>
            </div>
            {u.owner ? (
              <p style={{ fontFamily: mono, fontSize: 11, color: "var(--accent)", margin: 0 }}>Owner — full access</p>
            ) : (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {editableTabKeys.map((tab) => {
                  const key = `${u.id}:${tab}`;
                  const checked = u.tabAdmin?.[tab] === true;
                  return (
                    <label
                      key={tab}
                      style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: sans, fontSize: 13, color: "var(--text-dim)" }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={pending === key}
                        onChange={(e) => toggle(u.id, tab, e.target.checked)}
                      />
                      {tab}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
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
  const { user } = useUser();
  const [active, setActive] = useState<Tab>("Home");
  const [season, setSeason] = useState<string>("");
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [content, setContent] = useState<TabContentData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const s = document.documentElement.getAttribute("data-season");
    if (s) setSeason(s);
  }, []);

  useEffect(() => {
    fetch("/api/content")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load content.");
        return res.json();
      })
      .then((data) => setContent(data))
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  const metadata = (user?.publicMetadata ?? {}) as PublicMetadata;
  const isOwner = metadata.owner === true;
  const canEdit = (tab: EditableTab) => isOwner || metadata.tabAdmin?.[tab] === true;

  const tabs: Tab[] = isOwner ? [...baseTabs, "Admin"] : [...baseTabs];
  const usesContent = active !== "Admin";

  async function saveTab<K extends keyof TabContentData>(tab: K, next: TabContentData[K]) {
    const res = await fetch(`/api/content/${tab}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save.");
    }
    setContent((prev) => (prev ? { ...prev, [tab]: next } : prev));
  }

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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <UserButton
              appearance={{
                variables: {
                  colorPrimary: "#e8703a",
                  colorBackground: "var(--surface)",
                  colorText: "var(--text)",
                  colorTextSecondary: "var(--text-dim)",
                  colorInputBackground: "var(--bg)",
                  colorInputText: "var(--text)",
                  fontFamily: sans,
                },
                elements: {
                  avatarBox: { width: 26, height: 26 },
                  userButtonPopoverCard: {
                    border: "1px solid var(--surface-border)",
                    boxShadow: "none",
                  },
                },
              }}
            />
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
          </div>

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
            overflowX: "auto",
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
                  whiteSpace: "nowrap",
                  color: isActive ? "var(--accent)" : "var(--text-dim)",
                  borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {tab}
              </button>
            );
          })}
        </nav>

        {usesContent && !content && !loadError && (
          <Card>
            <p style={{ fontFamily: sans, fontSize: 14, color: "var(--text-dim)", margin: 0 }}>Loading…</p>
          </Card>
        )}
        {usesContent && loadError && (
          <Card>
            <p style={errorStyle}>{loadError}</p>
          </Card>
        )}

        {content && active === "Home" && (
          <HomeTab data={content.home} editable={canEdit("home")} onSave={(d) => saveTab("home", d)} />
        )}
        {content && active === "Projects" && (
          <ProjectsTab data={content.projects} editable={canEdit("projects")} onSave={(d) => saveTab("projects", d)} />
        )}
        {content && active === "Food" && (
          <FoodTab
            data={{ ...emptyFood, ...(content.food ?? {}) }}
            editable={canEdit("food")}
            onSave={(d) => saveTab("food", d)}
          />
        )}
        {content && active === "About" && (
          <AboutTab data={content.about} editable={canEdit("about")} onSave={(d) => saveTab("about", d)} />
        )}
        {content && active === "Contact" && (
          <ContactTab data={content.contact} editable={canEdit("contact")} onSave={(d) => saveTab("contact", d)} />
        )}
        {active === "Admin" && isOwner && <AdminTab />}
      </div>
    </main>
  );
}
