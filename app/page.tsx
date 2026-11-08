"use client";

import { useEffect, useRef, useState } from "react";
import { SignOutButton, UserButton, useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import WeatherEffects, { WeatherInfo } from "./WeatherEffects";
import FoodTab, { FoodContent } from "./FoodTab";
import ProjectsTab from "./ProjectsTab";
import GraffitiTab from "./graffiti/GraffitiTab";
import JobsTab from "./jobs/JobsTab";
import { normalizeProjects, Project } from "@/lib/projects";
import { readUrl, writeUrl } from "@/lib/urlState";
import AliveBackground from "./AliveBackground";
import { DEFAULT_PLAN } from "./foodDefaults";
import { Button, Card, CardSkeleton, Field, Input, TextArea } from "./ui/ui";
import { BottomBar, NavGroup, NavItem, Sidebar } from "./ui/AppNav";
import { userButtonAppearance } from "./ui/clerkAppearance";

const seasonLabels: Record<string, string> = {
  fall: "Fall theme",
  winter: "Winter theme",
  spring: "Spring theme",
  summer: "Summer theme",
};

const baseTabs = ["Home", "Projects", "Graffiti", "Work orders", "Lawn care", "Other jobs", "Food", "About", "Contact"] as const;
type Tab = (typeof baseTabs)[number] | "Admin";

// How the sections are grouped in the nav. The Dashboard is its own
// full-screen page, so it's a link rather than a tab.
const groupOf: Record<Tab, string> = {
  Home: "Personal",
  Projects: "Personal",
  Food: "Personal",
  About: "Personal",
  Contact: "Personal",
  Graffiti: "Field work",
  "Work orders": "Field work",
  "Lawn care": "Field work",
  "Other jobs": "Field work",
  Admin: "Tools",
};
const groupOrder = ["Personal", "Field work", "Tools"];

// Which sections earn a spot in the phone's bottom bar, best first.
const barPriority: Tab[] = ["Home", "Projects", "Graffiti", "Food", "Work orders", "Lawn care", "Other jobs", "About", "Contact", "Admin"];
const BAR_SLOTS = 4;

// Tabs that draw their own title (they're shared with the crew page).
const ownTitle = new Set<Tab>(["Graffiti", "Work orders", "Lawn care", "Other jobs"]);

type HomeContent = { headline: string; body: string };
type AboutContent = { body: string };
type ContactContent = { body: string; email: string };

type TabContentData = {
  home: HomeContent;
  projects: Project[];
  food: FoodContent;
  about: AboutContent;
  contact: ContactContent;
};

type EditableTab = "home" | "projects" | "graffiti" | "workorders" | "lawn" | "otherjobs" | "food" | "about" | "contact";

// Which nav tab corresponds to each permission key, in display order —
// used to build the visible tab list for a given identity (real or
// previewed): a tab only shows up in nav if that identity can edit it.
const tabLabelForKey: Record<EditableTab, Tab> = {
  home: "Home",
  projects: "Projects",
  graffiti: "Graffiti",
  workorders: "Work orders",
  lawn: "Lawn care",
  otherjobs: "Other jobs",
  food: "Food",
  about: "About",
  contact: "Contact",
};

type PublicMetadata = {
  owner?: boolean;
  tabAdmin?: Partial<Record<EditableTab | "invoice", boolean>>;
};

type AdminUser = {
  id: string;
  email: string;
  firstName: string | null;
  owner: boolean;
  tabAdmin: Partial<Record<EditableTab | "invoice", boolean>>;
};

// What the Admin tab's "View as" selector lets the owner preview: either a
// real user's actual metadata, or one of the built-in presets below. The
// rest of the page renders exactly as it would for someone with this
// metadata — same visible tabs, same edit buttons — without touching the
// owner's own Clerk session or anyone else's permissions.
type PreviewTarget = {
  id: string;
  label: string;
  metadata: PublicMetadata;
};

// Mirrors DEFAULT_TAB_ADMIN in lib/supabaseAdmin.ts (what a brand-new
// sign-up actually gets via the Clerk webhook). Kept as a separate literal
// because that file is server-only and must never reach the client bundle.
// If you change one, change the other.
const DEFAULT_NEW_USER_TAB_ADMIN: Partial<Record<EditableTab, boolean>> = {
  about: true,
  contact: true,
};

const emptyFood: FoodContent = { recipes: [], todos: [] };

// ---------- Editable text cards (Home, About, Contact) ----------

// Shared edit flow: reading view ↔ form in the same card, Save/Cancel,
// inline error, and a "Saved" toast once the server confirms.
function useEditor<T>(data: T, onSave: (next: T) => Promise<void>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(data);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(data);
  }, [data]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
      toast.success("Saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(data);
    setEditing(false);
    setError(null);
  }

  return { editing, setEditing, draft, setDraft, saving, error, save, cancel };
}

function EditActions({ saving, error, onSave, onCancel }: { saving: boolean; error: string | null; onSave: () => void; onCancel: () => void }) {
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <Button variant="primary" busy={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="quiet" onClick={onClick}>
      Edit
    </Button>
  );
}

function HomeTab({ data, editable, onSave }: { data: HomeContent; editable: boolean; onSave: (next: HomeContent) => Promise<void> }) {
  const ed = useEditor(data, onSave);

  if (ed.editing) {
    return (
      <Card>
        <div className="swap stack">
          <Field label="Headline">
            <Input value={ed.draft.headline} onChange={(e) => ed.setDraft({ ...ed.draft, headline: e.target.value })} autoFocus />
          </Field>
          <Field label="Text">
            <TextArea value={ed.draft.body} onChange={(e) => ed.setDraft({ ...ed.draft, body: e.target.value })} rows={4} />
          </Field>
          <EditActions saving={ed.saving} error={ed.error} onSave={ed.save} onCancel={ed.cancel} />
        </div>
      </Card>
    );
  }

  return (
    <Card corner={editable && <EditButton onClick={() => ed.setEditing(true)} />}>
      <div className="swap">
        <h2 className="home-headline">{data.headline}</h2>
        <p className="prose">{data.body}</p>
      </div>
    </Card>
  );
}

function AboutTab({ data, editable, onSave }: { data: AboutContent; editable: boolean; onSave: (next: AboutContent) => Promise<void> }) {
  const ed = useEditor(data, onSave);

  if (ed.editing) {
    return (
      <Card>
        <div className="swap stack">
          <Field label="About">
            <TextArea value={ed.draft.body} onChange={(e) => ed.setDraft({ body: e.target.value })} rows={6} autoFocus />
          </Field>
          <EditActions saving={ed.saving} error={ed.error} onSave={ed.save} onCancel={ed.cancel} />
        </div>
      </Card>
    );
  }

  return (
    <Card corner={editable && <EditButton onClick={() => ed.setEditing(true)} />}>
      <p className="prose swap" style={{ color: "var(--text)", paddingRight: 48 }}>
        {data.body}
      </p>
    </Card>
  );
}

function ContactTab({ data, editable, onSave }: { data: ContactContent; editable: boolean; onSave: (next: ContactContent) => Promise<void> }) {
  const ed = useEditor(data, onSave);

  if (ed.editing) {
    return (
      <Card>
        <div className="swap stack">
          <Field label="Intro line">
            <Input value={ed.draft.body} onChange={(e) => ed.setDraft({ ...ed.draft, body: e.target.value })} autoFocus />
          </Field>
          <Field label="Email address">
            <Input
              mono
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={ed.draft.email}
              onChange={(e) => ed.setDraft({ ...ed.draft, email: e.target.value })}
            />
          </Field>
          <EditActions saving={ed.saving} error={ed.error} onSave={ed.save} onCancel={ed.cancel} />
        </div>
      </Card>
    );
  }

  return (
    <Card corner={editable && <EditButton onClick={() => ed.setEditing(true)} />}>
      <div className="swap">
        <p className="prose" style={{ color: "var(--text)", margin: "0 0 14px", paddingRight: 48 }}>
          {data.body}
        </p>
        <a href={`mailto:${data.email}`} className="link-chip">
          {data.email}
        </a>
      </div>
    </Card>
  );
}

// ---------- Admin ----------

const editableTabKeys = ["home", "projects", "graffiti", "workorders", "lawn", "otherjobs", "food", "about", "contact"] as const;
// What the Admin tab can switch on per user: every tab, plus "invoice" (the invoice + prices for the job tabs that person has).
const permissionKeys = [...editableTabKeys, "invoice"] as const;
const permissionLabel: Record<(typeof permissionKeys)[number], string> = {
  home: "home",
  projects: "projects",
  graffiti: "graffiti",
  workorders: "work orders",
  lawn: "lawn care",
  otherjobs: "other jobs",
  food: "food",
  about: "about",
  contact: "contact",
  invoice: "invoice (prices)",
};

function AdminTab({
  preview,
  onPreview,
}: {
  preview: PreviewTarget | null;
  onPreview: (target: PreviewTarget | null) => void;
}) {
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

  // Presets cover cases with no real user to point at yet: what a brand-new
  // sign-up gets automatically, and the floor for someone granted nothing.
  const presets: PreviewTarget[] = [
    {
      id: "__default__",
      label: "a new sign-up (default access)",
      metadata: { owner: false, tabAdmin: DEFAULT_NEW_USER_TAB_ADMIN },
    },
    {
      id: "__none__",
      label: "a user with no tabs granted",
      metadata: { owner: false, tabAdmin: {} },
    },
  ];

  function handleSelect(id: string) {
    if (id === "__self__") {
      onPreview(null);
      return;
    }
    const preset = presets.find((p) => p.id === id);
    if (preset) {
      onPreview(preset);
      return;
    }
    const target = users?.find((u) => u.id === id);
    if (target) {
      onPreview({
        id: target.id,
        label: target.firstName || target.email,
        metadata: { owner: target.owner, tabAdmin: target.tabAdmin },
      });
    }
  }

  if (!users && !error) return <CardSkeleton lines={4} />;

  if (!users) {
    return (
      <Card>
        <p className="form-error" style={{ margin: 0 }}>
          {error}
        </p>
      </Card>
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div style={{ minWidth: 0, flex: "1 1 280px" }}>
            <Field label="View as">
              <select className="input" value={preview?.id ?? "__self__"} onChange={(e) => handleSelect(e.target.value)} style={{ maxWidth: 320 }}>
                <option value="__self__">Yourself (Owner)</option>
                <option value="__default__">New sign-up (default access)</option>
                <option value="__none__">No tabs granted</option>
                {users
                  .filter((u) => !u.owner)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName || u.email}
                    </option>
                  ))}
              </select>
            </Field>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "8px 0 0", maxWidth: 460 }}>
              Swaps the tabs and edit buttons you see across the whole site for that role's, so you can check what they actually get. It doesn't touch anyone's real permissions.
            </p>
          </div>
          {preview && <Button onClick={() => onPreview(null)}>Exit preview</Button>}
        </div>
      </Card>

      <Card>
        <p className="eyebrow">Access</p>
        <p className="muted" style={{ fontSize: 14, margin: "0 0 6px" }}>
          Grant or revoke edit access to each tab, per user.
        </p>
        {error && <p className="form-error">{error}</p>}
        {users.map((u) => (
          <div key={u.id} className="admin-user">
            <div className="admin-user-head">
              <span style={{ fontSize: 15, fontWeight: 500 }}>{u.firstName || u.email}</span>
              <span className="muted" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                {u.email}
              </span>
            </div>
            {u.owner ? (
              <p style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--accent)", margin: 0 }}>Owner — full access</p>
            ) : (
              <div className="row">
                {permissionKeys.map((tab) => {
                  const key = `${u.id}:${tab}`;
                  const checked = u.tabAdmin?.[tab] === true;
                  return (
                    <label key={tab} className="toggle-chip">
                      <input type="checkbox" checked={checked} disabled={pending === key} onChange={(e) => toggle(u.id, tab, e.target.checked)} />
                      <span className="toggle-dot" aria-hidden="true" />
                      {permissionLabel[tab]}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------- Home: today's meals at a glance ----------

const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function TodayCard({ food, onOpenFood }: { food: FoodContent; onOpenFood: () => void }) {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);
  if (!today) return <CardSkeleton lines={2} />;

  const plan = food.plan ?? DEFAULT_PLAN;
  const key = DAY_KEYS[today.getDay()];
  const lunch = plan.lunch.find((m) => m.day === key);
  const dinner = plan.dinner.find((m) => m.day === key);
  const prepDay = key === "Sun" ? "Mon–Wed" : key === "Wed" ? "Thu–Sun" : null;
  const openTodos = food.todos.filter((t) => !t.done).length;

  return (
    <Card>
      <p className="eyebrow">Today · {today.toLocaleDateString(undefined, { weekday: "long" })}</p>
      {prepDay && <p style={{ fontSize: 13, color: "var(--success)", margin: "0 0 4px" }}>Prep day: cook for {prepDay}.</p>}
      {[
        ["Lunch", lunch],
        ["Dinner", dinner],
      ].map(([label, meal]) => (
        <div key={label as string} className="today-meal">
          <p className="field-label" style={{ margin: "0 0 4px" }}>
            {label as string}
          </p>
          <p className="today-meal-name">{meal && typeof meal === "object" ? meal.name : "Nothing planned"}</p>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {openTodos > 0 ? `${openTodos} food to-do${openTodos === 1 ? "" : "s"} open` : "To-do list is clear"}
        </span>
        <Button variant="quiet" onClick={onOpenFood} style={{ fontSize: 13 }}>
          Open Food →
        </Button>
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

// The Home greeting arrives as one wave the first time it's shown on a page
// load. After that (coming back from another tab) it's just there.
let introPlayed = false;

export default function HomePage() {
  const { user, isLoaded } = useUser();
  const [active, setActive] = useState<Tab>("Home");
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  // Which way the last navigation went in nav order, so the new view comes in from that side.
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const activeRef = useRef<Tab>("Home");
  const [intro, setIntro] = useState(() => !introPlayed);

  function go(tab: Tab) {
    const order: Tab[] = [...baseTabs, "Admin"];
    setDir(order.indexOf(tab) < order.indexOf(activeRef.current) ? "back" : "fwd");
    activeRef.current = tab;
    setActive(tab);
  }

  // The address bar is the source of truth for which tab/project is open,
  // so back/forward work and any view can be linked to. Read it after mount
  // (not during render) so server and browser HTML match.
  useEffect(() => {
    const sync = () => {
      const { tab, project } = readUrl();
      const match = ([...baseTabs, "Admin"] as Tab[]).find((t) => t.toLowerCase() === tab);
      go(match ?? "Home");
      setOpenProject(match === "Projects" ? project : null);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function navigate(tab: Tab, project: string | null = null, mode: "push" | "replace" = "push") {
    go(tab);
    setOpenProject(tab === "Projects" ? project : null);
    writeUrl({ tab, project }, mode);
  }
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

  // realIsOwner is the actual signed-in user's own permission — it never
  // changes while previewing, so the owner can always get back to the
  // Admin tab (via the "Exit preview" banner) no matter which role they're
  // currently looking at. Everything else below — isOwner, canEdit, the
  // visible tab list — uses the *effective* metadata, which is the preview
  // target's metadata when previewing, or the owner's own otherwise. That's
  // what makes the rest of the page render exactly as that role would see it.
  const realIsOwner = metadata.owner === true;
  const effectiveMetadata = preview ? preview.metadata : metadata;
  const isOwner = effectiveMetadata.owner === true;
  const canEdit = (tab: EditableTab) => isOwner || effectiveMetadata.tabAdmin?.[tab] === true;

  // A non-owner (real or previewed) only gets the tabs they can actually
  // edit — a tab with no grant doesn't just lose its Edit button, it
  // disappears from nav entirely, matching what that account truly sees.
  const visibleBaseTabs: Tab[] = isOwner
    ? [...baseTabs]
    : editableTabKeys.filter((key) => canEdit(key)).map((key) => tabLabelForKey[key]);
  const tabs: Tab[] = isOwner ? [...visibleBaseTabs, "Admin"] : visibleBaseTabs;

  // Crew accounts never see the hub. Someone who has the graffiti tab but none of the real
  // hub tabs (home/projects/food; About and Contact are just the new-account defaults) goes
  // straight to /crew. Also: /crew leaves a one-time flag when it shows its sign-in, so if the
  // sign-in lands here instead of back on /crew, we send the person back there.
  const realMeta = metadata;
  const crewOnly =
    !preview &&
    realMeta.owner !== true &&
    realMeta.tabAdmin?.graffiti === true &&
    // the job tabs live on the main site for now: anyone who has one is not sent to /crew
    !realMeta.tabAdmin?.workorders &&
    !realMeta.tabAdmin?.lawn &&
    !realMeta.tabAdmin?.otherjobs &&
    !realMeta.tabAdmin?.home &&
    !realMeta.tabAdmin?.projects &&
    !realMeta.tabAdmin?.food;
  const [crewRedirect, setCrewRedirect] = useState(false);
  useEffect(() => {
    if (!isLoaded || !user) return;
    let flagged = false;
    try {
      flagged = window.sessionStorage.getItem("crewLogin") === "1";
      if (flagged) window.sessionStorage.removeItem("crewLogin");
    } catch {
      /* private mode: skip the flag */
    }
    if (crewOnly || flagged) {
      setCrewRedirect(true);
      window.location.replace("/crew");
    }
  }, [isLoaded, user, crewOnly]);
  const usesContent = active !== "Admin" && active !== "Graffiti" && active !== "Work orders" && active !== "Lawn care" && active !== "Other jobs";

  // Keep the active tab in sync with what's actually visible: a shared
  // ?tab=admin link does nothing for non-owners (send them Home), and
  // nobody can stay on a tab they've lost access to — whether from a role
  // change, entering/exiting preview, or a stale link. Gated on realIsOwner
  // for the Admin case (not the preview) so this never fires just because
  // the owner is previewing a non-owner role while still on the Admin tab.
  useEffect(() => {
    if (!isLoaded) return;
    if (active === "Admin") {
      if (!realIsOwner) navigate("Home", null, "replace");
      return;
    }
    if (!visibleBaseTabs.includes(active) && visibleBaseTabs.length > 0) {
      navigate(visibleBaseTabs[0], null, "replace");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, active, realIsOwner, visibleBaseTabs.join("|")]);

  // Browser tab title follows what's open ("Gmail cleanup · Isaac Borland").
  useEffect(() => {
    const projectName =
      active === "Projects" && openProject ? normalizeProjects(content?.projects).find((p) => p.id === openProject)?.name : null;
    document.title = projectName ? `${projectName} · Isaac Borland` : active === "Home" ? "Isaac Borland" : `${active} · Isaac Borland`;
  }, [active, openProject, content]);

  // The intro plays once: as soon as Home has real content to show it in.
  // Its classes stay on until you leave Home (the animations hold their last
  // frame), so nothing re-triggers an entrance mid-visit.
  const playIntro = intro && active === "Home" && content !== null;
  useEffect(() => {
    if (playIntro) introPlayed = true;
  }, [playIntro]);
  useEffect(() => {
    if (intro && active !== "Home") setIntro(false);
  }, [intro, active]);

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

  if (crewRedirect || crewOnly) {
    return (
      <>
        <AliveBackground />
        <main className="signin">
          <p className="muted" style={{ fontSize: 14 }}>
            Taking you to the crew page…
          </p>
        </main>
      </>
    );
  }

  // ---------- Nav model ----------

  const groups: NavGroup[] = groupOrder
    .map((label) => ({
      label,
      items: [
        ...tabs.filter((t) => groupOf[t] === label).map((t): NavItem => ({ key: t, label: t, icon: t })),
        ...(label === "Tools" ? [{ key: "Dashboard", label: "Dashboard", icon: "Dashboard" as const, href: "/dashboard" }] : []),
      ],
    }))
    .filter((g) => g.items.length > 0);
  const allItems = groups.flatMap((g) => g.items);
  const barItems: NavItem[] =
    allItems.length <= BAR_SLOTS + 1
      ? allItems
      : barPriority
          .filter((t) => tabs.includes(t))
          .slice(0, BAR_SLOTS)
          .map((t) => ({ key: t, label: t, icon: t }));
  const select = (item: NavItem) => {
    navigate(item.key as Tab);
    window.scrollTo({ top: 0 });
  };

  const timeText = now ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const dateText = now ? now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";

  // Clerk keeps one sign-in per browser, so this signs you out here and opens the crew login,
  // where you can sign in as a crew account (e.g. to see what crew see). Sign back in at /sign-in.
  const crewSwitch = realIsOwner && (
    <SignOutButton redirectUrl="/crew">
      <button type="button" className="switch-account" data-testid="crew-switch" title="Signs you out of this account and opens the crew login">
        Open crew page as another account →
      </button>
    </SignOutButton>
  );

  const sidebarTop = (
    <div className="sidebar-brand">
      <UserButton appearance={userButtonAppearance} />
      <p className="site-name">isaacborland.com</p>
    </div>
  );

  const sidebarFoot = (
    <div className="sidebar-foot">
      <div className="clock">{timeText || " "}</div>
      {dateText && <span className="status-line">{dateText}</span>}
      {weather && <span className="status-line">{weatherText(weather)}</span>}
      {seasonLabels[season] && <span className="chip">{seasonLabels[season]}</span>}
      <div>{crewSwitch}</div>
    </div>
  );

  // ---------- Views ----------

  let body: React.ReactNode = null;
  if (usesContent && loadError) {
    body = (
      <Card>
        <p className="form-error" style={{ margin: 0 }}>
          {loadError}
        </p>
      </Card>
    );
  } else if (usesContent && !content) {
    body =
      active === "Home" ? (
        <div className="home-grid">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={4} />
        </div>
      ) : (
        <CardSkeleton />
      );
  } else if (usesContent && content && visibleBaseTabs.length === 0) {
    body = (
      <Card>
        <p className="muted" style={{ fontSize: 14, margin: 0 }}>
          No tabs are available for this account yet.
        </p>
      </Card>
    );
  } else if (content && active === "Home" && canEdit("home")) {
    body = (
      <div className="home-grid">
        <div className={playIntro ? "intro-support" : undefined} style={{ "--delay": "150ms" } as React.CSSProperties}>
          <HomeTab data={content.home} editable={canEdit("home")} onSave={(d) => saveTab("home", d)} />
        </div>
        <div className={playIntro ? "intro-support" : undefined} style={{ "--delay": "190ms" } as React.CSSProperties}>
          <TodayCard food={food} onOpenFood={() => navigate("Food")} />
        </div>
      </div>
    );
  } else if (content && active === "Projects" && canEdit("projects")) {
    body = (
      <div className="legacy-zoom">
        <ProjectsTab
          projects={normalizeProjects(content.projects)}
          editable={canEdit("projects")}
          openId={openProject}
          onOpen={(id, mode) => navigate("Projects", id, mode)}
          onSave={(d) => saveTab("projects", d)}
          onReplaced={(raw) => setContent((prev) => (prev ? { ...prev, projects: normalizeProjects(raw) } : prev))}
        />
      </div>
    );
  } else if (active === "Graffiti" && canEdit("graffiti")) {
    body = (
      <div className="legacy-zoom">
        <GraffitiTab isOwner={isOwner} canInvoice={isOwner || effectiveMetadata.tabAdmin?.invoice === true} />
      </div>
    );
  } else if (active === "Work orders" && canEdit("workorders")) {
    body = (
      <div className="legacy-zoom">
        <JobsTab key="workorders" jtype="workorders" isOwner={isOwner} />
      </div>
    );
  } else if (active === "Lawn care" && canEdit("lawn")) {
    body = (
      <div className="legacy-zoom">
        <JobsTab key="lawn" jtype="lawn" isOwner={isOwner} />
      </div>
    );
  } else if (active === "Other jobs" && canEdit("otherjobs")) {
    body = (
      <div className="legacy-zoom">
        <JobsTab key="otherjobs" jtype="otherjobs" isOwner={isOwner} />
      </div>
    );
  } else if (content && active === "Food" && canEdit("food")) {
    body = (
      <div className="legacy-zoom">
        <FoodTab data={food} editable={canEdit("food")} onSave={(d) => saveTab("food", d)} />
      </div>
    );
  } else if (content && active === "About" && canEdit("about")) {
    body = <AboutTab data={content.about} editable={canEdit("about")} onSave={(d) => saveTab("about", d)} />;
  } else if (content && active === "Contact" && canEdit("contact")) {
    body = <ContactTab data={content.contact} editable={canEdit("contact")} onSave={(d) => saveTab("contact", d)} />;
  } else if (active === "Admin" && realIsOwner) {
    body = <AdminTab preview={preview} onPreview={setPreview} />;
  }

  const head =
    active === "Home" ? (
      <div className="home-hero">
        <div>
          <h1 className={playIntro ? "hero-title intro-lead" : "hero-title"}>
            {now ? greetingFor(now.getHours()) : "Welcome"}
            {firstName ? (
              <>
                , <span className="accent">{firstName}</span>.
              </>
            ) : (
              "."
            )}
          </h1>
          <p className={playIntro ? "lede intro-support" : "lede"} style={{ "--delay": "90ms" } as React.CSSProperties}>
            Your projects, your plans, your place.
          </p>
          {(dateText || weather) && (
            <p className={playIntro ? "hero-meta intro-deco" : "hero-meta"} style={{ "--delay": "150ms" } as React.CSSProperties}>
              {[dateText, weatherText(weather)].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>
    ) : ownTitle.has(active) ? null : (
      <div className="page-head">
        <div>
          <p className="eyebrow">{groupOf[active]}</p>
          <h1 className="page-title">{active}</h1>
        </div>
      </div>
    );

  return (
    <>
      <AliveBackground />
      <WeatherEffects onWeatherChange={setWeather} />

      <div className="app">
        <Sidebar groups={groups} activeKey={active} onSelect={select} top={sidebarTop} foot={sidebarFoot} />

        <main className="main">
          <header className="mobile-top">
            <div className="brand">
              <UserButton appearance={userButtonAppearance} />
              <p className="site-name">isaacborland.com</p>
            </div>
            <span className="mobile-time">{timeText}</span>
          </header>

          {preview && (
            <div className="banner" role="status">
              <span>
                <strong>Previewing as {preview.label}.</strong> Tabs and edit buttons now match exactly what they'd see. Anything you actually save while
                previewing still saves for real, under your own account.
              </span>
              <Button size="sm" onClick={() => setPreview(null)}>
                Exit preview
              </Button>
            </div>
          )}

          {/* One entrance per view: while the Home intro plays, the view itself holds still. */}
          <div className={playIntro ? undefined : "view"} key={active} data-dir={dir}>
            {head}
            {body}
          </div>
        </main>

        <BottomBar
          groups={groups}
          primary={barItems}
          activeKey={active}
          onSelect={select}
          sheetExtra={crewSwitch ? <div style={{ padding: "8px 12px 0" }}>{crewSwitch}</div> : undefined}
        />
      </div>
    </>
  );
}
