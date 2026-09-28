"use client";

import { useEffect, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import WeatherEffects, { WeatherInfo } from "./WeatherEffects";
import FoodTab, { FoodContent } from "./FoodTab";
import AliveBackground from "./AliveBackground";
import { DEFAULT_PLAN } from "./foodDefaults";

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
    <div className="card">
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
      <h2 style={{ fontFamily: mono, fontWeight: 600, fontSize: 30, lineHeight: 1.25, margin: "0 0 12px 0", paddingRight: 48 }}>
        {data.headline}
      </h2>
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

// ---------- Nav icons (inline so there's nothing extra to load) ----------

function Icon({ name }: { name: Tab }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "Home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5h13V10" />
          <path d="M10 19.5v-5h4v5" />
        </svg>
      );
    case "Projects":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "Food":
      return (
        <svg {...common}>
          <path d="M7 3v8a2 2 0 0 0 2 2v8" />
          <path d="M5 3v5.5M9 3v5.5" />
          <path d="M16.5 21V3c-2.2 1.3-3.5 4-3.5 7.5 0 1.9 1 3 3.5 3" />
        </svg>
      );
    case "About":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
        </svg>
      );
    case "Contact":
      return (
        <svg {...common}>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="m3.5 7 8.5 6 8.5-6" />
        </svg>
      );
    case "Admin":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6L12 3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
  }
}

// ---------- Home: today's meals at a glance ----------

const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function TodayCard({ food, onOpenFood }: { food: FoodContent; onOpenFood: () => void }) {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);
  if (!today) return <Card>{null}</Card>;

  const plan = food.plan ?? DEFAULT_PLAN;
  const key = DAY_KEYS[today.getDay()];
  const lunch = plan.lunch.find((m) => m.day === key);
  const dinner = plan.dinner.find((m) => m.day === key);
  const prepDay = key === "Sun" ? "Mon–Wed" : key === "Wed" ? "Thu–Sun" : null;
  const openTodos = food.todos.filter((t) => !t.done).length;

  return (
    <Card>
      <p style={{ fontFamily: mono, fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4px 0" }}>
        Today · {today.toLocaleDateString(undefined, { weekday: "long" })}
      </p>
      {prepDay && (
        <p style={{ fontFamily: sans, fontSize: 13, color: "#8fbf7f", margin: "0 0 8px 0" }}>Prep day: cook for {prepDay}.</p>
      )}
      {[
        ["Lunch", lunch],
        ["Dinner", dinner],
      ].map(([label, meal]) => (
        <div key={label as string} className="today-meal">
          <p style={{ fontFamily: mono, fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", margin: "0 0 3px 0" }}>
            {label as string}
          </p>
          <p style={{ fontFamily: sans, fontSize: 16, fontWeight: 600, margin: 0 }}>
            {meal && typeof meal === "object" ? meal.name : "Nothing planned"}
          </p>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: sans, fontSize: 13, color: "var(--text-dim)" }}>
          {openTodos > 0 ? `${openTodos} food to-do${openTodos === 1 ? "" : "s"} open` : "To-do list is clear"}
        </span>
        <button style={{ ...editButtonStyle, fontSize: 13 }} onClick={onOpenFood}>
          Open Food →
        </button>
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

function greetingFor(hour: number) {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const { user } = useUser();
  const [active, setActive] = useState<Tab>("Home");
  const [season, setSeason] = useState<string>("");
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [content, setContent] = useState<TabContentData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const s = document.documentElement.getAttribute("data-season");
    if (s) setSeason(s);
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(t);
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
  const food: FoodContent = { ...emptyFood, ...(content?.food ?? {}) };

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

  const firstName = user?.firstName?.trim();

  return (
    <>
      <AliveBackground />
      <WeatherEffects onWeatherChange={setWeather} />

      <main className="shell">
        <header className="topbar">
          <div style={{ minWidth: 0 }}>
            <div className="brand">
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
                    avatarBox: { width: 30, height: 30 },
                    userButtonPopoverCard: {
                      border: "1px solid var(--surface-border)",
                      boxShadow: "none",
                    },
                  },
                }}
              />
              <p className="site-name">isaacborland.com</p>
            </div>
            <h1 className="greeting">
              {now ? greetingFor(now.getHours()) : "Welcome"}
              {firstName ? (
                <>
                  , <span className="accent">{firstName}</span>.
                </>
              ) : (
                "."
              )}
            </h1>
            <p className="subline">Your projects, your plans, your place.</p>
          </div>

          <div className="status">
            <div className="clock">{now ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : " "}</div>
            {now && <span className="status-line">{now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>}
            {weather && <span className="status-line">{weatherText(weather)}</span>}
            {seasonLabels[season] && <span className="chip">{seasonLabels[season]}</span>}
          </div>
        </header>

        <nav className="tabs" aria-label="Sections">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={tab === active ? "tab active" : "tab"}
              aria-current={tab === active ? "page" : undefined}
              onClick={() => {
                setActive(tab);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <Icon name={tab} />
              <span>{tab}</span>
            </button>
          ))}
        </nav>

        <div className="tab-content" key={active}>
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
            <div className="home-grid">
              <HomeTab data={content.home} editable={canEdit("home")} onSave={(d) => saveTab("home", d)} />
              <TodayCard food={food} onOpenFood={() => setActive("Food")} />
            </div>
          )}
          {content && active === "Projects" && (
            <ProjectsTab data={content.projects} editable={canEdit("projects")} onSave={(d) => saveTab("projects", d)} />
          )}
          {content && active === "Food" && (
            <FoodTab data={food} editable={canEdit("food")} onSave={(d) => saveTab("food", d)} />
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
    </>
  );
}
