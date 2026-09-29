"use client";

import { useEffect, useMemo, useState } from "react";
import { newId, Project, projectId, PROJECT_STATUSES, ProjectLink, safeUrl, todayISO } from "@/lib/projects";
import { absoluteUrl, hrefFor } from "@/lib/urlState";

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

// ---------- Styles ----------

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--surface-border)",
  borderRadius: 8,
  color: "var(--text)",
  fontFamily: sans,
  fontSize: 14,
  padding: "9px 11px",
  boxSizing: "border-box",
};
const primaryBtn: React.CSSProperties = {
  fontFamily: sans,
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 8,
  cursor: "pointer",
  background: "var(--accent)",
  border: "none",
  color: "#1a0f08",
  fontWeight: 600,
};
const ghostBtn: React.CSSProperties = {
  fontFamily: sans,
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 8,
  cursor: "pointer",
  background: "none",
  border: "1px solid var(--surface-border)",
  color: "var(--text-dim)",
};
const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: mono,
  fontSize: 12,
  color: "var(--accent)",
  padding: 0,
};
const dimText: React.CSSProperties = { fontFamily: sans, fontSize: 13, lineHeight: 1.55, color: "var(--text-dim)", margin: 0 };
const errorStyle: React.CSSProperties = { fontFamily: sans, fontSize: 13, color: "#e88", margin: "8px 0 0 0" };
const labelStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  color: "var(--accent)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: "0 0 6px 0",
};
const sectionTitle: React.CSSProperties = { fontFamily: mono, fontSize: 18, fontWeight: 600, margin: 0 };

const STATUS_COLOR: Record<string, string> = {
  idea: "#c9a0ff",
  planned: "#7fb3d5",
  "in progress": "var(--accent)",
  paused: "#e8b86a",
  done: "#8fbf7f",
};
const statusColor = (s: string) => STATUS_COLOR[s.toLowerCase()] ?? "var(--text-dim)";

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const c = statusColor(status);
  return (
    <span
      style={{
        fontFamily: mono,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: c,
        border: `1px solid ${c}`,
        borderRadius: 999,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${value}%` }} />
    </div>
  );
}

// ---------- Project editor (new + edit) ----------

function ProjectForm({
  initial,
  saving,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Project;
  saving: boolean;
  submitLabel: string;
  onSubmit: (p: Project) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [status, setStatus] = useState(initial.status);
  const [progress, setProgress] = useState(initial.progress);
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const [links, setLinks] = useState<ProjectLink[]>(initial.links.length ? initial.links : []);
  const [error, setError] = useState<string | null>(null);

  const statuses = PROJECT_STATUSES.includes(initial.status) ? PROJECT_STATUSES : [initial.status, ...PROJECT_STATUSES];

  function submit() {
    const cleanLinks: ProjectLink[] = [];
    for (const l of links) {
      if (!l.url.trim() && !l.label.trim()) continue;
      const url = safeUrl(l.url);
      if (!url) {
        setError(`"${l.url || l.label}" doesn't look like a web link (e.g. github.com/you/repo).`);
        return;
      }
      cleanLinks.push({ label: l.label.trim() || url, url });
    }
    setError(null);
    onSubmit({
      ...initial,
      name: name.trim(),
      status,
      progress,
      summary: summary.trim(),
      description: description.trim(),
      links: cleanLinks,
    });
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>
          <p style={labelStyle}>Project name</p>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Gmail cleanup" />
        </label>
        <label>
          <p style={labelStyle}>Status</p>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <p style={labelStyle}>Progress · {progress}%</p>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent)", marginTop: 8 }}
          />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <p style={labelStyle}>One-line summary</p>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} style={inputStyle} placeholder="What it is, in one sentence" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <p style={labelStyle}>Description</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder="Goals, how it works, what's left to do…"
          />
        </label>
        <div style={{ gridColumn: "1 / -1" }}>
          <p style={labelStyle}>Links</p>
          {links.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={l.label}
                onChange={(e) => setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Label (e.g. GitHub)"
                style={{ ...inputStyle, flex: "0 0 32%" }}
              />
              <input
                value={l.url}
                onChange={(e) => setLinks((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                placeholder="https://…"
                inputMode="url"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button style={{ ...ghostBtn, padding: "8px 12px" }} aria-label="Remove link" onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <button style={linkBtn} onClick={() => setLinks((prev) => [...prev, { label: "", url: "" }])}>
            + Add link
          </button>
        </div>
      </div>
      {error && <p style={errorStyle}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button style={primaryBtn} disabled={saving || !name.trim()} onClick={submit}>
          {saving ? "Saving…" : submitLabel}
        </button>
        <button style={ghostBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- Project page ----------

function ProjectPage({
  project,
  editable,
  saving,
  onBack,
  onChange,
  onDelete,
}: {
  project: Project;
  editable: boolean;
  saving: boolean;
  onBack: () => void;
  onChange: (next: Project) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [updateText, setUpdateText] = useState("");
  const [updateDate, setUpdateDate] = useState(todayISO());
  const [updateProgress, setUpdateProgress] = useState(project.progress);
  const [updateStatus, setUpdateStatus] = useState(project.status);

  useEffect(() => {
    setUpdateProgress(project.progress);
    setUpdateStatus(project.status);
  }, [project.progress, project.status]);

  const statuses = PROJECT_STATUSES.includes(project.status) ? PROJECT_STATUSES : [project.status, ...PROJECT_STATUSES];
  const lastUpdate = project.updates[0];

  async function copyLink() {
    const url = absoluteUrl({ tab: "projects", project: project.id });
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard blocked (older browsers / some in-app browsers): show it instead.
      window.prompt("Copy this link:", url);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function postUpdate() {
    const text = updateText.trim();
    if (!text) return;
    const changes: string[] = [];
    if (updateStatus !== project.status) changes.push(`status → ${updateStatus}`);
    if (updateProgress !== project.progress) changes.push(`progress ${project.progress}% → ${updateProgress}%`);
    const entry = { id: newId(), date: updateDate || todayISO(), text: changes.length ? `${text}\n(${changes.join(", ")})` : text };
    const updates = [entry, ...project.updates].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (await onChange({ ...project, updates, progress: updateProgress, status: updateStatus })) {
      setUpdateText("");
      setUpdateDate(todayISO());
    }
  }

  return (
    <>
      <button style={{ ...linkBtn, fontSize: 13, marginBottom: 16 }} onClick={onBack}>
        ← All projects
      </button>

      {editing ? (
        <ProjectForm
          initial={project}
          saving={saving}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (next) => {
            if (await onChange(next)) setEditing(false);
          }}
        />
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontFamily: mono, fontSize: 30, lineHeight: 1.2, margin: "0 0 10px 0" }}>{project.name}</h2>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <StatusBadge status={project.status} />
                {lastUpdate && <span style={{ ...dimText, fontSize: 12 }}>Last update {fmtDate(lastUpdate.date)}</span>}
                {project.suggestedBy && <span style={{ ...dimText, fontSize: 12 }}>· Suggested by {project.suggestedBy}</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={ghostBtn} onClick={copyLink}>
                {copied ? "Link copied!" : "Copy link"}
              </button>
              {editable && (
                <button style={ghostBtn} onClick={() => setEditing(true)}>
                  Edit details
                </button>
              )}
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={labelStyle}>Progress</span>
              <span style={{ fontFamily: mono, fontSize: 13 }}>{project.progress}%</span>
            </div>
            <ProgressBar value={project.progress} />
          </div>

          {project.summary && <p style={{ fontFamily: sans, fontSize: 17, lineHeight: 1.5, margin: "20px 0 0 0" }}>{project.summary}</p>}
          {project.description && (
            <div style={{ marginTop: 16 }}>
              {project.description.split(/\n{2,}/).map((para, i) => (
                <p key={i} style={{ ...dimText, fontSize: 15, whiteSpace: "pre-wrap", marginBottom: 10 }}>
                  {para}
                </p>
              ))}
            </div>
          )}
          {!project.summary && !project.description && (
            <p style={{ ...dimText, marginTop: 16 }}>{editable ? "No description yet. Hit Edit details to add goals, notes and links." : "No description yet."}</p>
          )}

          {project.links.length > 0 && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
              {project.links.map((l, i) => {
                const url = safeUrl(l.url);
                return url ? (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="link-chip">
                    {l.label} ↗
                  </a>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}

      <div className="project-detail-grid">
        {editable && (
          <div className="card">
            <p style={{ ...sectionTitle, marginBottom: 14 }}>Post an update</p>
            <textarea
              value={updateText}
              onChange={(e) => setUpdateText(e.target.value)}
              rows={4}
              placeholder="What changed? What did you learn? What's next?"
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label>
                <p style={labelStyle}>Date</p>
                <input type="date" value={updateDate} onChange={(e) => setUpdateDate(e.target.value)} style={inputStyle} />
              </label>
              <label>
                <p style={labelStyle}>Status</p>
                <select value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value)} style={inputStyle}>
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <p style={labelStyle}>Progress now · {updateProgress}%</p>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={updateProgress}
                  onChange={(e) => setUpdateProgress(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--accent)" }}
                />
              </label>
            </div>
            <button style={{ ...primaryBtn, marginTop: 14 }} disabled={saving || !updateText.trim()} onClick={postUpdate}>
              {saving ? "Saving…" : "Post update"}
            </button>
          </div>
        )}

        <div className="card">
          <p style={{ ...sectionTitle, marginBottom: 14 }}>
            Updates <span style={{ ...dimText, fontSize: 13 }}>({project.updates.length})</span>
          </p>
          {project.updates.length === 0 && <p style={dimText}>No updates yet.</p>}
          <ol className="timeline">
            {project.updates.map((u) => (
              <li key={u.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontFamily: mono, fontSize: 12, color: "var(--accent)" }}>{fmtDate(u.date)}</span>
                  {editable && (
                    <button
                      style={{ ...linkBtn, color: "var(--text-dim)" }}
                      disabled={saving}
                      onClick={() => {
                        if (window.confirm("Delete this update?")) onChange({ ...project, updates: project.updates.filter((x) => x.id !== u.id) });
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <p style={{ ...dimText, color: "var(--text)", fontSize: 14, whiteSpace: "pre-wrap", marginTop: 4 }}>{u.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {editable && (
        <button
          style={{ ...linkBtn, color: "#e88", marginTop: 20 }}
          disabled={saving}
          onClick={async () => {
            if (window.confirm(`Delete "${project.name}" and all its updates? This can't be undone.`)) await onDelete();
          }}
        >
          Delete project
        </button>
      )}
    </>
  );
}

// ---------- Suggestions board ----------

type Suggestion = {
  id: string;
  title: string;
  details: string;
  submitterName: string;
  status: "pending" | "accepted" | "declined";
  votes: number;
  voted: boolean;
  mine: boolean;
  projectId: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function Suggestions({
  onAccepted,
  onOpenProject,
}: {
  onAccepted: (projects: unknown, projectId: string) => void;
  onOpenProject: (id: string) => void;
}) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "submit" or a suggestion id
  const [error, setError] = useState<string | null>(null);
  const [showReviewed, setShowReviewed] = useState(false);

  useEffect(() => {
    api<{ suggestions: Suggestion[]; canReview: boolean }>("/api/suggestions")
      .then((d) => {
        setItems(d.suggestions);
        setCanReview(d.canReview);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  const pending = useMemo(
    () => (items ?? []).filter((s) => s.status === "pending").sort((a, b) => b.votes - a.votes || (a.createdAt < b.createdAt ? 1 : -1)),
    [items]
  );
  const reviewed = useMemo(() => (items ?? []).filter((s) => s.status !== "pending"), [items]);

  const replace = (s: Suggestion) => setItems((prev) => (prev ?? []).map((x) => (x.id === s.id ? s : x)));

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    await run("submit", async () => {
      const d = await api<{ suggestion: Suggestion }>("/api/suggestions", {
        method: "POST",
        body: JSON.stringify({ title, details }),
      });
      setItems((prev) => [d.suggestion, ...(prev ?? [])]);
      setTitle("");
      setDetails("");
    });
  }

  const act = (s: Suggestion, action: "vote" | "accept" | "decline" | "reopen") =>
    run(s.id, async () => {
      const d = await api<{ suggestion: Suggestion; projects?: unknown; projectId?: string }>(`/api/suggestions/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      replace(d.suggestion);
      if (action === "accept" && d.projects && d.projectId) onAccepted(d.projects, d.projectId);
    });

  const remove = (s: Suggestion) =>
    run(s.id, async () => {
      await api(`/api/suggestions/${s.id}`, { method: "DELETE" });
      setItems((prev) => (prev ?? []).filter((x) => x.id !== s.id));
    });

  return (
    <section style={{ marginTop: 36 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h3 style={{ ...sectionTitle, fontSize: 20 }}>Suggested projects</h3>
        <span style={{ ...dimText, fontSize: 12 }}>
          {canReview ? "Anyone signed in can suggest. You review." : "Got an idea? Suggest it. Upvote the ones you'd use."}
        </span>
      </div>

      <div className="suggest-grid">
        <div className="card">
          <p style={{ ...labelStyle, marginBottom: 10 }}>Suggest a project</p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Idea in a few words" style={inputStyle} />
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="What would it do? Why would it be useful?"
            style={{ ...inputStyle, marginTop: 10, resize: "vertical" }}
          />
          <button style={{ ...primaryBtn, marginTop: 12 }} disabled={busy === "submit" || !title.trim()} onClick={submit}>
            {busy === "submit" ? "Sending…" : "Submit idea"}
          </button>
        </div>

        <div className="card">
          <p style={{ ...labelStyle, marginBottom: 10 }}>Waiting for review ({pending.length})</p>
          {loadError && <p style={errorStyle}>{loadError}</p>}
          {!items && !loadError && <p style={dimText}>Loading…</p>}
          {items && pending.length === 0 && <p style={dimText}>No open suggestions. Be the first.</p>}
          {pending.map((s, i) => (
            <div key={s.id} style={{ display: "flex", gap: 14, padding: "14px 0", borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.08)" }}>
              <button
                className={s.voted ? "vote voted" : "vote"}
                disabled={busy === s.id}
                onClick={() => act(s, "vote")}
                aria-label={s.voted ? "Remove your upvote" : "Upvote"}
                aria-pressed={s.voted}
              >
                <span aria-hidden="true">▲</span>
                <span>{s.votes}</span>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: sans, fontSize: 15, fontWeight: 600, margin: 0 }}>{s.title}</p>
                {s.details && <p style={{ ...dimText, whiteSpace: "pre-wrap", marginTop: 4 }}>{s.details}</p>}
                <p style={{ ...dimText, fontSize: 12, marginTop: 6 }}>
                  {s.mine ? "You" : s.submitterName} · {fmtDate(s.createdAt)}
                </p>
                {(canReview || s.mine) && (
                  <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                    {canReview && (
                      <>
                        <button style={linkBtn} disabled={busy === s.id} onClick={() => act(s, "accept")}>
                          Accept → project
                        </button>
                        <button style={{ ...linkBtn, color: "var(--text-dim)" }} disabled={busy === s.id} onClick={() => act(s, "decline")}>
                          Decline
                        </button>
                      </>
                    )}
                    <button
                      style={{ ...linkBtn, color: "#e88" }}
                      disabled={busy === s.id}
                      onClick={() => {
                        if (window.confirm(`Delete the suggestion "${s.title}"?`)) remove(s);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {reviewed.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
              <button style={{ ...linkBtn, color: "var(--text-dim)" }} onClick={() => setShowReviewed((v) => !v)}>
                {showReviewed ? "Hide" : "Show"} reviewed ({reviewed.length})
              </button>
              {showReviewed &&
                reviewed.map((s) => (
                  <div key={s.id} style={{ padding: "10px 0", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: sans, fontSize: 14 }}>
                      {s.title} <span style={{ ...dimText, fontSize: 12 }}>· {s.submitterName}</span>
                    </span>
                    <span style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                      <StatusBadge status={s.status} />
                      {s.status === "accepted" && s.projectId && (
                        <button style={linkBtn} onClick={() => onOpenProject(s.projectId as string)}>
                          Open
                        </button>
                      )}
                      {canReview && (
                        <button style={{ ...linkBtn, color: "var(--text-dim)" }} disabled={busy === s.id} onClick={() => act(s, "reopen")}>
                          Reopen
                        </button>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          )}
          {error && <p style={errorStyle}>{error}</p>}
        </div>
      </div>
    </section>
  );
}

// ---------- Main ----------

export default function ProjectsTab({
  projects,
  editable,
  openId,
  onOpen,
  onSave,
  onReplaced,
}: {
  projects: Project[];
  editable: boolean;
  openId: string | null; // comes from the address bar
  onOpen: (id: string | null, mode?: "push" | "replace") => void;
  onSave: (next: Project[]) => Promise<void>;
  onReplaced: (raw: unknown) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = openId ? projects.find((p) => p.id === openId) ?? null : null;

  useEffect(() => {
    if (openId || creating) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [openId, creating]);

  async function persist(next: Project[]): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (openId && !open) {
    return (
      <div className="card">
        <p style={{ ...sectionTitle, marginBottom: 8 }}>Project not found</p>
        <p style={dimText}>It may have been deleted, or the link is incomplete.</p>
        <button style={{ ...primaryBtn, marginTop: 16 }} onClick={() => onOpen(null, "replace")}>
          See all projects
        </button>
      </div>
    );
  }

  if (open) {
    return (
      <>
        <ProjectPage
          project={open}
          editable={editable}
          saving={saving}
          onBack={() => onOpen(null)}
          onChange={(next) => persist(projects.map((p) => (p.id === next.id ? next : p)))}
          onDelete={async () => {
            const ok = await persist(projects.filter((p) => p.id !== open.id));
            // Replace, so the back button can't land on the deleted project.
            if (ok) onOpen(null, "replace");
            return ok;
          }}
        />
        {error && <p style={errorStyle}>{error}</p>}
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h3 style={{ ...sectionTitle, fontSize: 20 }}>
          Projects <span style={{ ...dimText, fontSize: 14 }}>({projects.length})</span>
        </h3>
        {editable && !creating && (
          <button style={primaryBtn} onClick={() => setCreating(true)}>
            + New project
          </button>
        )}
      </div>

      {creating && (
        <ProjectForm
          initial={{ id: "", name: "", status: "idea", summary: "", description: "", progress: 0, links: [], updates: [], createdAt: new Date().toISOString() }}
          saving={saving}
          submitLabel="Create project"
          onCancel={() => setCreating(false)}
          onSubmit={async (p) => {
            const withFirst = { ...p, id: projectId(p.name), updates: [{ id: newId(), date: todayISO(), text: "Project created." }] };
            if (await persist([withFirst, ...projects])) {
              setCreating(false);
              onOpen(withFirst.id);
            }
          }}
        />
      )}

      {projects.length === 0 && !creating && (
        <div className="card">
          <p style={dimText}>No projects yet.</p>
        </div>
      )}

      <div className="project-grid">
        {projects.map((p) => {
          const last = p.updates[0];
          return (
            <a
              key={p.id}
              href={hrefFor({ tab: "projects", project: p.id })}
              className="card project-card"
              onClick={(e) => {
                // Let Ctrl/Cmd/Shift/middle-click open a new tab as usual.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onOpen(p.id);
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 600, lineHeight: 1.25, textAlign: "left" }}>{p.name}</span>
                <StatusBadge status={p.status} />
              </div>
              <p style={{ ...dimText, textAlign: "left", marginTop: 10, minHeight: 20 }}>{p.summary || (editable ? "Add a summary →" : "")}</p>
              <div style={{ marginTop: "auto", paddingTop: 16 }}>
                <ProgressBar value={p.progress} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <span style={{ fontFamily: mono, fontSize: 11, color: "var(--text-dim)" }}>{p.progress}% done</span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: "var(--text-dim)" }}>
                    {last ? `Updated ${fmtDate(last.date)}` : "No updates"}
                  </span>
                </div>
              </div>
            </a>
          );
        })}
      </div>
      {error && <p style={errorStyle}>{error}</p>}

      <Suggestions
        onAccepted={(raw, id) => {
          onReplaced(raw);
          onOpen(id);
        }}
        onOpenProject={(id) => onOpen(id)}
      />
    </>
  );
}
